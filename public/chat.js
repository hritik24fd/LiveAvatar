

let SPEECH_REGION, SPEECH_KEY, OPENAI_ENDPOINT, OPENAI_KEY, OPENAI_DEPLOYMENT_NAME;
let TTS_VOICE, PERSONAL_VOICE_ID, AVATAR_CHARACTER, AVATAR_STYLE;

fetch('/api/config')
    .then(response => response.json())
    .then(config => {
        SPEECH_REGION = config.SPEECH_REGION;
        SPEECH_KEY = config.SPEECH_KEY;
        OPENAI_ENDPOINT = config.OPENAI_ENDPOINT;
        OPENAI_KEY = config.OPENAI_KEY;
        OPENAI_DEPLOYMENT_NAME = config.OPENAI_DEPLOYMENT_NAME;
        TTS_VOICE = config.TTS_VOICE;
        PERSONAL_VOICE_ID = config.PERSONAL_VOICE_ID;
        AVATAR_CHARACTER = config.AVATAR_CHARACTER;
        AVATAR_STYLE = config.AVATAR_STYLE;
        initializeApp();
    })
    .catch(err => console.error("Failed to load config:", err));

function initializeApp() {
    let inactivityTimer = null;
    const INACTIVITY_LIMIT_MS = 60000;

    let speechRecognizer;
    let avatarSynthesizer;
    let peerConnection;

    let sessionActive = false;
    let connectionReady = false;
    let isSpeaking = false;
    let spokenTextQueue = [];
    let messages = [];
    let messageQueue = [];

    window.onload = () => {
        document.getElementById('localIdleContainer').hidden = false;
        document.getElementById('videoContainer').hidden = true;

        document.getElementById('stopSession').onclick = manualStopSession;
        document.getElementById('microphone').onclick = toggleMicrophone;
        document.getElementById('stopSpeaking').onclick = stopSpeaking;
        document.getElementById('clearChatHistory').onclick = clearChatHistory;
        document.getElementById('sendMessage').onclick = userSentMessage;

        initMessages();
    };

    function resetInactivityTimer() {
        if (inactivityTimer) clearTimeout(inactivityTimer);
        inactivityTimer = setTimeout(() => {
            console.log("No user activity for 60s => stopping session.");
            stopSession();
            revertToLocalIdle();
        }, INACTIVITY_LIMIT_MS);
    }

    function revertToLocalIdle() {
        console.log("Reverting to local idle video.");
        document.getElementById('videoContainer').hidden = true;
        document.getElementById('localIdleContainer').hidden = false;
    }

    function manualStopSession() {
        console.log("User clicked ‘Close Avatar Session’ manually.");
        stopSession();
        revertToLocalIdle();
    }

    function switchToAzureAvatar() {
        console.log("Switching to Azure session in background (idle container remains until feed is playing).");
        startSession();
        resetInactivityTimer();
    }

    function startSession() {
        document.getElementById('inputContainer').hidden = false;
        document.getElementById('chatHistory').hidden = false;
        document.getElementById('clearChatHistory').disabled = false;
        document.getElementById('stopSession').disabled = false;
        document.getElementById('microphone').disabled = false;
        document.getElementById('stopSpeaking').disabled = false;

        connectAvatar();
        sessionActive = true;
    }

    function stopSession() {
        disconnectAvatar();
    }

    function connectAvatar() {
        if (!SPEECH_KEY) {
            console.error("Speech Key missing!");
            return;
        }
        if (!OPENAI_KEY) {
            console.error("OpenAI Key missing!");
            return;
        }

        const speechSynthesisConfig = SpeechSDK.SpeechConfig.fromSubscription(SPEECH_KEY, SPEECH_REGION);
        const avatarConfig = new SpeechSDK.AvatarConfig(AVATAR_CHARACTER, AVATAR_STYLE);
        avatarConfig.customized = false;
        avatarSynthesizer = new SpeechSDK.AvatarSynthesizer(speechSynthesisConfig, avatarConfig);

        avatarSynthesizer.avatarEventReceived = (s, e) => {
            console.log("Avatar event: " + e.description + ", offset: " + e.offset);
        };

        const speechRecognitionConfig = SpeechSDK.SpeechConfig.fromSubscription(SPEECH_KEY, SPEECH_REGION);
        speechRecognitionConfig.setProperty(
            SpeechSDK.PropertyId.SpeechServiceConnection_LanguageIdMode,
            "Continuous"
        );
        const autoDetectLangConfig = SpeechSDK.AutoDetectSourceLanguageConfig.fromLanguages(["en-US"]);
        speechRecognizer = SpeechSDK.SpeechRecognizer.FromConfig(
            speechRecognitionConfig,
            autoDetectLangConfig,
            SpeechSDK.AudioConfig.fromDefaultMicrophoneInput()
        );

        const tokenUrl = `https://${SPEECH_REGION}.tts.speech.microsoft.com/cognitiveservices/avatar/relay/token/v1`;
        fetch(tokenUrl, {
            method: 'GET',
            headers: { 'Ocp-Apim-Subscription-Key': SPEECH_KEY }
        })
            .then(response => response.json())
            .then(data => {
                setupWebRTC(data.Urls[0], data.Username, data.Password);
            })
            .catch(error => {
                console.error("Error retrieving token: ", error);
            });
    }

    function disconnectAvatar() {
        if (avatarSynthesizer) avatarSynthesizer.close();
        if (speechRecognizer) {
            speechRecognizer.stopContinuousRecognitionAsync();
            speechRecognizer.close();
        }
        if (peerConnection) peerConnection.close();
        sessionActive = false;
        connectionReady = false;
        messageQueue = [];
    }

    function setupWebRTC(iceUrl, iceUser, icePass) {
        peerConnection = new RTCPeerConnection({
            iceServers: [{
                urls: [iceUrl],
                username: iceUser,
                credential: icePass
            }]
        });

        peerConnection.ontrack = (event) => {
            if (event.track.kind === 'audio') {
                const audioElem = document.createElement('audio');
                audioElem.id = 'audioPlayer';
                audioElem.srcObject = event.streams[0];
                audioElem.autoplay = true;
                audioElem.onplaying = () => console.log("WebRTC audio connected.");
                const remoteDiv = document.getElementById('remoteVideo');
                [...remoteDiv.childNodes].filter(n => n.localName === 'audio')
                    .forEach(n => remoteDiv.removeChild(n));
                remoteDiv.appendChild(audioElem);
            }
            if (event.track.kind === 'video') {
                const videoElem = document.createElement('video');
                videoElem.id = 'videoPlayer';
                videoElem.srcObject = event.streams[0];
                videoElem.autoplay = true;
                videoElem.playsInline = true;
                videoElem.width = 960;
                videoElem.height = 540;
                videoElem.onplaying = () => {
                    console.log("WebRTC video connected => showing azure container, hiding idle container now.");
                    document.getElementById('localIdleContainer').hidden = true;
                    document.getElementById('videoContainer').hidden = false;

                    connectionReady = true;

                    if (messageQueue.length > 0) {
                        messageQueue.forEach(msg => handleUserQuery(msg));
                        messageQueue = [];
                    }
                };
                const remoteDiv = document.getElementById('remoteVideo');
                [...remoteDiv.childNodes].filter(n => n.localName === 'video')
                    .forEach(n => remoteDiv.removeChild(n));
                remoteDiv.appendChild(videoElem);
            }
        };

        peerConnection.addEventListener("datachannel", evt => {
            const dataChannel = evt.channel;
            dataChannel.onmessage = e => console.log("WebRTC event: ", e.data);
        });
        peerConnection.createDataChannel("eventChannel");

        peerConnection.addTransceiver('video', { direction: 'sendrecv' });
        peerConnection.addTransceiver('audio', { direction: 'sendrecv' });

        avatarSynthesizer.startAvatarAsync(peerConnection)
            .then(r => {
                if (r.reason === SpeechSDK.ResultReason.SynthesizingAudioCompleted) {
                    console.log("Avatar started successfully.");
                } else {
                    console.log("Unable to start avatar. Reason: ", r.reason);
                }
            })
            .catch(error => console.log("Avatar failed to start: ", error));
    }

    function toggleMicrophone() {
        if (!sessionActive) {
            console.log("User clicked microphone, session inactive => switching to Azure");
            switchToAzureAvatar();
        }

        resetInactivityTimer();
        const btn = document.getElementById('microphone');

        if (btn.innerHTML === "Stop Microphone") {
            btn.disabled = true;
            speechRecognizer.stopContinuousRecognitionAsync(() => {
                btn.innerHTML = "Start Microphone";
                btn.disabled = false;
            }, err => console.error("Failed to stop mic: ", err));
            return;
        }

        btn.disabled = true;
        speechRecognizer.recognized = async (s, e) => {
            if (e.result.reason === SpeechSDK.ResultReason.RecognizedSpeech) {
                resetInactivityTimer();
                const userQuery = e.result.text.trim();
                if (!userQuery) return;

                btn.disabled = true;
                speechRecognizer.stopContinuousRecognitionAsync(() => {
                    btn.innerHTML = "Start Microphone";
                    btn.disabled = false;
                }, err => console.error("Failed to stop mic: ", err));

                handleUserQuery(userQuery);
            }
        };

        speechRecognizer.startContinuousRecognitionAsync(() => {
            btn.innerHTML = "Stop Microphone";
            btn.disabled = false;
        }, err => {
            console.error("Failed to start mic: ", err);
            btn.disabled = false;
        });
    }

    function userSentMessage() {
        const userBox = document.getElementById('userMessageBox');
        const text = userBox.value.trim();
        if (!text) return;

        if (!sessionActive) {
            console.log("User typed message, session inactive => switching to Azure in background");
            switchToAzureAvatar();
        }

        resetInactivityTimer();

        if (!connectionReady) {
            console.log("Connection not ready => queueing user message:", text);
            messageQueue.push(text);
            userBox.value = "";
            return;
        }

        handleUserQuery(text);
        userBox.value = "";
    }

    function handleUserQuery(userQuery) {
        resetInactivityTimer();
        messages.push({ role: 'user', content: userQuery });
        appendToChatHistory("<br />You: " + userQuery);

        if (isSpeaking) stopSpeaking();

        const url = `${OPENAI_ENDPOINT}openai/deployments/${OPENAI_DEPLOYMENT_NAME}/chat/completions?api-version=2023-06-01-preview`;
        const body = JSON.stringify({ messages, stream: true });

        let assistantReply = "";
        fetch(url, {
            method: "POST",
            headers: {
                "api-key": OPENAI_KEY,
                "Content-Type": "application/json"
            },
            body
        })
            .then(response => {
                if (!response.ok) {
                    throw new Error(`OpenAI status: ${response.status}`);
                }
                appendToChatHistory("<br/>Assistant:");
                const reader = response.body.getReader();

                function readChunk(prevChunk = "") {
                    return reader.read().then(({ value, done }) => {
                        if (done) return;
                        let chunkStr = new TextDecoder().decode(value);
                        if (prevChunk) chunkStr = prevChunk + chunkStr;
                        if (!chunkStr.endsWith("}\n\n") && !chunkStr.endsWith("[DONE]\n\n")) {
                            return readChunk(chunkStr);
                        }
                        chunkStr.split("\n\n").forEach(line => {
                            if (!line.startsWith("data:") || line.includes("[DONE]")) return;
                            try {
                                const json = JSON.parse(line.replace("data:", "").trim());
                                const token = json.choices[0].delta?.content;
                                if (token) {
                                    assistantReply += token;
                                    appendToChatHistory(token.replace(/\n/g, "<br/>"));
                                }
                            } catch (err) {
                                console.error("Error parsing chunk: ", err);
                            }
                        });
                        return readChunk();
                    });
                }
                return readChunk();
            })
            .then(() => {
                messages.push({ role: 'assistant', content: assistantReply });
                speak(assistantReply);
            })
            .catch(err => {
                console.error("OpenAI fetch error:", err);
                appendToChatHistory("<br/><i>Something went wrong.</i>");
            });
    }

    function speak(text, endingSilenceMs = 0) {
        resetInactivityTimer();
        if (!avatarSynthesizer) return;
        if (isSpeaking) {
            spokenTextQueue.push(text);
            return;
        }
        speakNext(text, endingSilenceMs);
    }

    function speakNext(text, endingSilenceMs = 0) {
        let ssml = `
      <speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis'
             xmlns:mstts='http://www.w3.org/2001/mstts' xml:lang='en-US'>
        <voice name='${TTS_VOICE}'>
          <mstts:ttsembedding speakerProfileId='${PERSONAL_VOICE_ID}'>
            <mstts:leadingsilence-exact value='0'/>
            ${escapeXml(text)}
            ${endingSilenceMs > 0 ? `<break time='${endingSilenceMs}ms' />` : ""}
          </mstts:ttsembedding>
        </voice>
      </speak>
    `;
        isSpeaking = true;
        document.getElementById('stopSpeaking').disabled = false;

        avatarSynthesizer.speakSsmlAsync(ssml).then(result => {
            if (result.reason === SpeechSDK.ResultReason.SynthesizingAudioCompleted) {
                console.log("Speech synthesized for:", text);
            }
            if (spokenTextQueue.length > 0) {
                speakNext(spokenTextQueue.shift());
            } else {
                isSpeaking = false;
                document.getElementById('stopSpeaking').disabled = true;
            }
        }).catch(error => {
            console.error("TTS error:", error);
            if (spokenTextQueue.length > 0) {
                speakNext(spokenTextQueue.shift());
            } else {
                isSpeaking = false;
                document.getElementById('stopSpeaking').disabled = true;
            }
        });
    }

    function stopSpeaking() {
        spokenTextQueue = [];
        if (!avatarSynthesizer) return;
        avatarSynthesizer.stopSpeakingAsync(() => {
            isSpeaking = false;
            document.getElementById('stopSpeaking').disabled = true;
        }, err => console.error("Error stopping TTS:", err));
    }

    function initMessages() {
        messages = [];
        messages.push({
            role: 'system',
            content: "You are a voice assistant named as Rosy; limit replies to 25 words. Do not speak emojis or special characters."
        });
    }

    function clearChatHistory() {
        messages = [];
        document.getElementById('chatHistory').innerHTML = "";
        initMessages();
    }

    function appendToChatHistory(text) {
        const chatBox = document.getElementById('chatHistory');
        chatBox.innerHTML += text;
        chatBox.scrollTop = chatBox.scrollHeight;
    }

    function escapeXml(s) {
        return s
            .replace(/&/g, "&amp;")
            .replace(/\"/g, "&quot;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
    }
}
