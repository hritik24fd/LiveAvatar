
require('dotenv').config();
const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/config', (req, res) => {
    res.json({
        SPEECH_REGION: process.env.SPEECH_REGION,
        SPEECH_KEY: process.env.SPEECH_KEY,
        OPENAI_ENDPOINT: process.env.OPENAI_ENDPOINT,
        OPENAI_KEY: process.env.OPENAI_KEY,
        OPENAI_DEPLOYMENT_NAME: process.env.OPENAI_DEPLOYMENT_NAME,
        TTS_VOICE: process.env.TTS_VOICE,
        PERSONAL_VOICE_ID: process.env.PERSONAL_VOICE_ID,
        AVATAR_CHARACTER: process.env.AVATAR_CHARACTER,
        AVATAR_STYLE: process.env.AVATAR_STYLE
    });
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
