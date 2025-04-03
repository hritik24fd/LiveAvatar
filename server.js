// server.js
require('dotenv').config();
const express = require('express');
const path = require('path');
const fetch = require('node-fetch');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/config', (req, res) => {
    res.json({
        SPEECH_REGION: process.env.SPEECH_REGION,
        TTS_VOICE: process.env.TTS_VOICE,
        PERSONAL_VOICE_ID: process.env.PERSONAL_VOICE_ID,
        AVATAR_CHARACTER: process.env.AVATAR_CHARACTER,
        AVATAR_STYLE: process.env.AVATAR_STYLE
    });
});

app.get('/api/azure-token', async (req, res) => {
    try {
        const region = process.env.SPEECH_REGION;
        const authTokenUrl = `https://${region}.api.cognitive.microsoft.com/sts/v1.0/issueToken`;
        const authResponse = await fetch(authTokenUrl, {
            method: 'POST',
            headers: { 'Ocp-Apim-Subscription-Key': process.env.SPEECH_KEY }
        });
        const authToken = await authResponse.text();

        const relayTokenUrl = `https://${region}.tts.speech.microsoft.com/cognitiveservices/avatar/relay/token/v1`;
        const relayResponse = await fetch(relayTokenUrl, {
            method: 'GET',
            headers: { 'Ocp-Apim-Subscription-Key': process.env.SPEECH_KEY }
        });
        const relayData = await relayResponse.json();
        res.json({
            authToken: authToken,
            iceUrl: relayData.Urls[0],
            username: relayData.Username,
            password: relayData.Password
        });
    } catch (error) {
        console.error("Error retrieving Azure tokens:", error);
        res.status(500).json({ error: 'Failed to retrieve tokens' });
    }
});

app.post('/api/openai-chat', express.json(), async (req, res) => {
    try {
        const url = `${process.env.OPENAI_ENDPOINT}openai/deployments/${process.env.OPENAI_DEPLOYMENT_NAME}/chat/completions?api-version=2023-06-01-preview`;
        const response = await fetch(url, {
            method: "POST",
            headers: {
                "api-key": process.env.OPENAI_KEY,
                "Content-Type": "application/json"
            },
            body: JSON.stringify(req.body)
        });
        res.status(response.status);
        response.body.pipe(res);
    } catch (error) {
        console.error("OpenAI proxy error:", error);
        res.status(500).json({ error: 'Failed to process request' });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
