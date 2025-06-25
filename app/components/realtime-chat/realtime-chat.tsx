import VoiceIcon from "@/app/icons/voice.svg";
import VoiceOffIcon from "@/app/icons/voice-off.svg";
import PowerIcon from "@/app/icons/power.svg";

import styles from "./realtime-chat.module.scss";
import clsx from "clsx";

import { useState, useRef, useEffect } from "react";

import { useChatStore, createMessage, useAppConfig } from "@/app/store";

import { IconButton } from "@/app/components/button";

import { RealtimeClient } from "@openai/realtime-api-beta";
import { AudioHandler } from "@/app/lib/audio";
import { uploadImage } from "@/app/utils/chat";
import { VoicePrint } from "@/app/components/voice-print";

interface RealtimeChatProps {
  onClose?: () => void;
  onStartVoice?: () => void;
  onPausedVoice?: () => void;
}

export function RealtimeChat({
  onClose,
  onStartVoice,
  onPausedVoice,
}: RealtimeChatProps) {
  const chatStore = useChatStore();
  const session = chatStore.currentSession();
  const config = useAppConfig();
  const [status, setStatus] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [modality, setModality] = useState("audio");
  const [useVAD, setUseVAD] = useState(true);
  const [frequencies, setFrequencies] = useState<Uint8Array | undefined>();

  const clientRef = useRef<RealtimeClient | null>(null);
  const audioHandlerRef = useRef<AudioHandler | null>(null);
  const initRef = useRef(false);

  const temperature = config.realtimeConfig.temperature;
  const apiKey = config.realtimeConfig.apiKey;
  const model = config.realtimeConfig.model;
  const azure = config.realtimeConfig.provider === "Azure";
  const azureEndpoint = config.realtimeConfig.azure.endpoint;
  const azureDeployment = config.realtimeConfig.azure.deployment;
  const voice = config.realtimeConfig.voice;

  const handleConnect = async () => {
    if (isConnecting || isConnected) {
      await disconnect();
      return;
    }
    try {
      setIsConnecting(true);

      // We do not recommend this, your API keys are at risk if you connect to OpenAI directly from the browser.
      // see: https://github.com/openai/openai-realtime-api-beta?tab=readme-ov-file#browser-front-end-quickstart
      clientRef.current = new RealtimeClient({
        apiKey,
        dangerouslyAllowAPIKeyInBrowser: true,
      });

      // Set up event handling
      startResponseListener();

      // Connect to Realtime API
      await clientRef.current.connect();

      // Can set parameters ahead of connecting, either separately or all at once
      await clientRef.current.updateSession({
        model,
        voice,
        temperature,
        turn_detection: (useVAD
          ? { type: "server_vad" }
          : { type: "none" }) as any,
      });

      setIsConnected(true);
      // TODO
      // try {
      //   const recentMessages = chatStore.getMessagesWithMemory();
      //   for (const message of recentMessages) {
      //     const { role, content } = message;
      //     if (typeof content === "string") {
      //       await clientRef.current.sendItem({
      //         type: "message",
      //         role: role as any,
      //         content: [
      //           {
      //             type: (role === "assistant" ? "text" : "input_text") as any,
      //             text: content as string,
      //           },
      //         ],
      //       });
      //     }
      //   }
      //   // await clientRef.current.generateResponse();
      // } catch (error) {
      //   console.error("Set message failed:", error);
      // }
    } catch (error) {
      console.error("Connection failed:", error);
      setStatus("Connection failed");
    } finally {
      setIsConnecting(false);
    }
  };

  const disconnect = async () => {
    if (clientRef.current) {
      try {
        await clientRef.current.disconnect();
        clientRef.current = null;
        setIsConnected(false);
      } catch (error) {
        console.error("Disconnect failed:", error);
      }
    }
  };

  const startResponseListener = async () => {
    if (!clientRef.current) return;

    clientRef.current.on("conversation.updated", (event: any) => {
      const { item, delta } = event;
      handleResponse(item, delta);
    });

    clientRef.current.on("close", () => {
      disconnect();
    });

    clientRef.current.on("error", (e: any) => {
      console.error("realtime error:", e);
      disconnect();
    });

    clientRef.current.on("conversation.item.completed", (event: any) => {
      const { item } = event;
      if (item.type === "message" && item.role === "user") {
        handleInputAudio(item);
      }
    });
  };

  const handleResponse = async (
    item: any,
    delta: { audio?: Int16Array; transcript?: string } | null,
  ) => {
    if (item.type !== "message" || item.role !== "assistant") return;
    const { id } = item;
    const botMessage =
      chatStore.currentSession().messages.find((m) => m.id === id) ??
      createMessage({
        id,
        role: item.role,
        content: "",
      });
    // add bot message first
    if (!chatStore.currentSession().messages.find((m) => m.id === id)) {
      chatStore.updateTargetSession(session, (session) => {
        session.messages = session.messages.concat([botMessage]);
      });
    }

    if (delta) {
      if (delta.transcript) {
        botMessage.content += delta.transcript;
      }
      if (delta.audio) {
        audioHandlerRef.current?.startStreamingPlayback();
        audioHandlerRef.current?.playChunk(new Uint8Array(delta.audio.buffer));
      }
      // update message.content
      chatStore.updateTargetSession(session, (session) => {
        session.messages = session.messages.concat();
      });
    } else if (item.status === "completed") {
      // upload audio get audio_url
      const blob = audioHandlerRef.current?.savePlayFile();
      if (blob && blob.size > 0) {
        uploadImage(blob!).then((audio_url) => {
          botMessage.audio_url = audio_url;
          // update text and audio_url
          chatStore.updateTargetSession(session, (session) => {
            session.messages = session.messages.concat();
          });
        });
      }
    }
  };

  const handleInputAudio = async (item: any) => {
    const { text, audio_slice } = item;
    if (text) {
      const userMessage = createMessage({
        role: "user",
        content: text,
      });
      chatStore.updateTargetSession(session, (session) => {
        session.messages = session.messages.concat([userMessage]);
      });
      // save input audio_url, and update session
      const { audio_start_ms, audio_end_ms } = audio_slice;
      // upload audio get audio_url
      const blob = audioHandlerRef.current?.saveRecordFile(
        audio_start_ms,
        audio_end_ms,
      );
      if (blob && blob.size > 0) {
        uploadImage(blob!).then((audio_url) => {
          userMessage.audio_url = audio_url;
          chatStore.updateTargetSession(session, (session) => {
            session.messages = session.messages.concat();
          });
        });
      }
    }
    // stop streaming play after get input audio.
    audioHandlerRef.current?.stopStreamingPlayback();
  };

  const toggleRecording = async () => {
    if (!isRecording && clientRef.current) {
      try {
        if (!audioHandlerRef.current) {
          audioHandlerRef.current = new AudioHandler();
          await audioHandlerRef.current.initialize();
        }
        await audioHandlerRef.current.startRecording(async (chunk) => {
          clientRef.current?.appendInputAudio(new Int16Array(chunk.buffer));
        });
        setIsRecording(true);
      } catch (error) {
        console.error("Failed to start recording:", error);
      }
    } else if (audioHandlerRef.current) {
      try {
        audioHandlerRef.current.stopRecording();
        if (!useVAD) {
          await clientRef.current?.createResponse();
        }
      } catch (e) {
        console.error(e);
      } finally {
        setIsRecording(false);
      }
    }
  };

  useEffect(() => {
    // 防止重复初始化
    if (initRef.current) return;
    initRef.current = true;

    const initAudioHandler = async () => {
      const handler = new AudioHandler();
      await handler.initialize();
      audioHandlerRef.current = handler;
      await handleConnect();
      await toggleRecording();
    };

    initAudioHandler().catch((error) => {
      setStatus(error);
      console.error(error);
    });

    return () => {
      if (isRecording) {
        toggleRecording();
      }
      audioHandlerRef.current?.close().catch(console.error);
      disconnect();
    };
  }, []);

  useEffect(() => {
    let animationFrameId: number;

    if (isConnected && isRecording) {
      const animationFrame = () => {
        if (audioHandlerRef.current) {
          const freqData = audioHandlerRef.current.getByteFrequencyData();
          setFrequencies(freqData);
        }
        animationFrameId = requestAnimationFrame(animationFrame);
      };

      animationFrameId = requestAnimationFrame(animationFrame);
    } else {
      setFrequencies(undefined);
    }

    return () => {
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
      }
    };
  }, [isConnected, isRecording]);

  // update session params
  useEffect(() => {
    clientRef.current?.updateSession({ voice });
  }, [voice]);
  useEffect(() => {
    clientRef.current?.updateSession({ temperature });
  }, [temperature]);

  const handleClose = async () => {
    onClose?.();
    if (isRecording) {
      await toggleRecording();
    }
    disconnect().catch(console.error);
  };

  return (
    <div className={styles["realtime-chat"]}>
      <div
        className={clsx(styles["circle-mic"], {
          [styles["pulse"]]: isRecording,
        })}
      >
        <VoicePrint frequencies={frequencies} isActive={isRecording} />
      </div>

      <div className={styles["bottom-icons"]}>
        <div>
          <IconButton
            icon={isRecording ? <VoiceIcon /> : <VoiceOffIcon />}
            onClick={toggleRecording}
            disabled={!isConnected}
            shadow
            bordered
          />
        </div>
        <div className={styles["icon-center"]}>{status}</div>
        <div>
          <IconButton
            icon={<PowerIcon />}
            onClick={handleClose}
            shadow
            bordered
          />
        </div>
      </div>
    </div>
  );
}
