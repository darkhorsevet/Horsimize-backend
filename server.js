
  
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Serve frontend
const path = require('path');
const fs = require('fs');
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(__dirname));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ============================================================
// INIT DATABASE TABLES
// ============================================================
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email VARCHAR(255) UNIQUE,
      name VARCHAR(255),
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS horses (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      name VARCHAR(255) NOT NULL,
      age INTEGER,
      breed VARCHAR(255),
      weight_lbs INTEGER,
      primary_use VARCHAR(100),
      bcs INTEGER CHECK (bcs BETWEEN 1 AND 9),
      health_flags TEXT[],
      photo_url TEXT,
      notes TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS feed_scans (
      id SERIAL PRIMARY KEY,
      horse_id INTEGER REFERENCES horses(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      feed_name VARCHAR(255),
      brand VARCHAR(255),
      match_score INTEGER,
      verdict TEXT,
      nutrients JSONB,
      warnings TEXT[],
      positives TEXT[],
      recommendations JSONB,
      feeding_recommendation TEXT,
      raw_analysis JSONB,
      scanned_at TIMESTAMP DEFAULT NOW()
    );
  `);
  console.log('✅ Database tables ready');
}

initDB().catch(console.error);

// ============================================================
// HEALTH CHECK
// ============================================================
app.get('/health', (req, res) => {
  res.json({ status: 'Horsimize API running 🐴', version: '1.0.0' });
});

// ============================================================
// USERS
// ============================================================
app.post('/api/users', async (req, res) => {
  const { email, name } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO users (email, name) VALUES ($1, $2)
       ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
       RETURNING *`,
      [email, name]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// HORSES
// ============================================================

// Get all horses for a user
app.get('/api/horses/:userId', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM horses WHERE user_id = $1 ORDER BY created_at DESC',
      [req.params.userId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create a horse
app.post('/api/horses', async (req, res) => {
  const { user_id, name, age, breed, weight_lbs, primary_use, bcs, health_flags, photo_url, notes } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO horses (user_id, name, age, breed, weight_lbs, primary_use, bcs, health_flags, photo_url, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [user_id, name, age, breed, weight_lbs, primary_use, bcs, health_flags, photo_url, notes]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update a horse
app.put('/api/horses/:id', async (req, res) => {
  const { name, age, breed, weight_lbs, primary_use, bcs, health_flags, photo_url, notes } = req.body;
  try {
    const result = await pool.query(
      `UPDATE horses SET name=$1, age=$2, breed=$3, weight_lbs=$4, primary_use=$5,
       bcs=$6, health_flags=$7, photo_url=$8, notes=$9, updated_at=NOW()
       WHERE id=$10 RETURNING *`,
      [name, age, breed, weight_lbs, primary_use, bcs, health_flags, photo_url, notes, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete a horse
app.delete('/api/horses/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM horses WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// FEED SCAN - THE CORE FEATURE
// ============================================================
app.post('/api/analyze-feed', async (req, res) => {
  const { imageBase64, mediaType, horse, userId } = req.body;

  if (!imageBase64) return res.status(400).json({ error: 'No image provided' });

  const horseContext = horse ? `
Horse Profile Being Matched:
- Name: ${horse.name}
- Age: ${horse.age} years old
- Breed: ${horse.breed}
- Weight: ${horse.weight_lbs || 'unknown'} lbs
- Primary Use: ${horse.primary_use}
- Body Condition Score: ${horse.bcs}/9 (1=emaciated, 5=ideal, 9=obese)
- Health Flags: ${horse.health_flags?.join(', ') || 'None'}
` : 'No specific horse profile provided - give general assessment.';

  const prompt = `You are Dr. Robert, an equine veterinarian with 20+ years of experience and deep expertise in equine nutrition.

Analyze this horse feed tag image carefully.

${horseContext}

Return ONLY a valid JSON object with no markdown, no explanation, just raw JSON:
{
  "feedName": "exact product name from label",
  "brand": "brand name",
  "intendedUse": "what this feed is designed for",
  "nutrients": {
    "crudeProtein": "X%",
    "crudeFat": "X%",
    "crudeFiber": "X%",
    "moisture": "X%",
    "nsc": "low/medium/high",
    "sugar": "value if listed or null",
    "starch": "value if listed or null",
    "calcium": "value if listed or null",
    "phosphorus": "value if listed or null"
  },
  "keyIngredients": ["top 5 ingredients in order"],
  "matchScore": <integer 0-100>,
  "verdict": "one clear sentence about this feed for this specific horse",
  "warnings": ["specific concern 1", "specific concern 2"],
  "positives": ["what this feed does well for this horse"],
  "recommendations": [
    {
      "name": "Better feed product name",
      "brand": "Purina or other",
      "reason": "why it is better for this specific horse",
      "matchScore": <integer>,
      "estimatedCostPerLb": "$X.XX"
    }
  ],
  "feedingRecommendation": "Specific daily amount in lbs, frequency, and any special instructions for this horse based on their weight, BCS, and activity level",
  "dailyAmountLbs": <number>
}

Be a real veterinarian here. Flag molasses for IR horses. Flag high NSC for easy keepers. Flag low fat for hard keepers. Recommend Purina alternatives first when applicable since this app is used at Purina feed stores.`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-opus-4-6',
        max_tokens: 2000,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mediaType || 'image/jpeg',
                data: imageBase64
              }
            },
            { type: 'text', text: prompt }
          ]
        }]
      })
    });

    const data = await response.json();

    if (!data.content || !data.content[0]) {
      return res.status(500).json({ error: 'No response from Claude', raw: data });
    }

    const text = data.content[0].text;
    const clean = text.replace(/```json|```/g, '').trim();
    const result = JSON.parse(clean);

    // Save scan to database if we have horse info
    if (horse?.id && userId) {
      await pool.query(
        `INSERT INTO feed_scans
         (horse_id, user_id, feed_name, brand, match_score, verdict, nutrients, warnings, positives, recommendations, feeding_recommendation, raw_analysis)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          horse.id, userId, result.feedName, result.brand, result.matchScore,
          result.verdict, result.nutrients, result.warnings, result.positives,
          JSON.stringify(result.recommendations), result.feedingRecommendation,
          JSON.stringify(result)
        ]
      );
    }

    res.json(result);

  } catch (err) {
    console.error('Analysis error:', err);
    res.status(500).json({ error: 'Analysis failed', details: err.message });
  }
});

// ============================================================
// SCAN HISTORY
// ============================================================
app.get('/api/scans/:horseId', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM feed_scans WHERE horse_id = $1 ORDER BY scanned_at DESC LIMIT 50',
      [req.params.horseId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// START SERVER
// ============================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🐴 Horsimize API running on port ${PORT}`));
                
        


