"use client"

import { useCloud } from "@/cloud/useCloud";
import React, { createContext, useState } from "react";
import { useCallback } from "react";
import { useConfig } from "./useConfig";
import { useToast } from "@/components/toast/ToasterProvider";

export type ConnectionMode = "cloud" | "manual" | "env"

type TokenGeneratorData = {
  shouldConnect: boolean;
  wsUrl: string;
  token: string;
  mode: ConnectionMode;
  disconnect: () => Promise<void>;
  connect: (mode: ConnectionMode) => Promise<void>;
};

const ConnectionContext = createContext<TokenGeneratorData | undefined>(undefined);

export const ConnectionProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const { generateToken, wsUrl: cloudWSUrl } = useCloud();
  const { setToastMessage } = useToast();
  const { config } = useConfig();
  const [connectionDetails, setConnectionDetails] = useState<{
    wsUrl: string;
    token: string;
    mode: ConnectionMode;
    shouldConnect: boolean;
  }>({ wsUrl: "", token: "", shouldConnect: false, mode: "manual" });

  const connect = useCallback(
    async (mode: ConnectionMode) => {
      let token = "";
      let url = "";
      if (mode === "cloud") {
        try {
          token = await generateToken();
        } catch (error) {
          setToastMessage({
            type: "error",
            message:
              "Failed to generate token, you may need to increase your role in this LiveKit Cloud project.",
          });
        }
        url = cloudWSUrl;
      } else if (mode === "env") {
        if (!process.env.NEXT_PUBLIC_LIVEKIT_URL) {
          throw new Error("NEXT_PUBLIC_LIVEKIT_URL is not set");
        }
        url = process.env.NEXT_PUBLIC_LIVEKIT_URL;

        // Read the session ID that InterviewForm generated and stored in localStorage.
        // This is passed as the LiveKit room name so the backend agent joins the
        // correct room for this specific user — keeping all data isolated per session.
        const sessionId = localStorage.getItem("currentSessionId");

        const params = new URLSearchParams();
        if (sessionId) {
          // Use the session ID as the room name so every user gets a unique room.
          params.append('roomName', sessionId);
          console.log(`🔑 Requesting token for room (sessionId): ${sessionId}`);
        } else if (config.settings.room_name) {
          params.append('roomName', config.settings.room_name);
          console.warn("⚠️ No currentSessionId in localStorage, using config room_name");
        }

        if (config.settings.participant_name) {
          params.append('participantName', config.settings.participant_name);
        }
        
        try {
          const response = await fetch(`/api/token?${params}`);
          
          if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Token generation failed: ${response.status} - ${errorText || response.statusText}`);
          }
          
          const data = await response.json();
          
          if (!data.accessToken) {
            throw new Error("No access token received from server");
          }
          
          token = data.accessToken;
          console.log(`✅ LiveKit token received for session ${sessionId}`);
        } catch (error: any) {
          setToastMessage({
            type: "error",
            message: error.message || "Failed to connect. Please check if backend is running on port 8000.",
          });
          throw error;
        }
      } else {
        token = config.settings.token;
        url = config.settings.ws_url;
      }
      setConnectionDetails({ wsUrl: url, token, shouldConnect: true, mode });
    },
    [
      cloudWSUrl,
      config.settings.token,
      config.settings.ws_url,
      config.settings.room_name,
      config.settings.participant_name,
      generateToken,
      setToastMessage,
    ]
  );

  const disconnect = useCallback(async () => {
    console.log("🔌 Disconnecting — clearing all session data from localStorage...");

    // Remove the core session keys so a fresh session ID is generated next time.
    localStorage.removeItem("currentSessionId");
    localStorage.removeItem("currentCandidateData");
    localStorage.removeItem("currentResumeData");

    // Remove all proctoring and transcript keys that belong to any session.
    // Keys are prefixed with "proctor_" or "interview_transcripts_" plus the session ID.
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (key.startsWith("proctor_") || key.startsWith("interview_transcripts_"))) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach((k) => localStorage.removeItem(k));

    console.log(`🗑️ Cleared ${keysToRemove.length} session-specific localStorage keys`);

    setConnectionDetails((prev) => ({ ...prev, shouldConnect: false }));
  }, []);

  return (
    <ConnectionContext.Provider
      value={{
        wsUrl: connectionDetails.wsUrl,
        token: connectionDetails.token,
        shouldConnect: connectionDetails.shouldConnect,
        mode: connectionDetails.mode,
        connect,
        disconnect,
      }}
    >
      {children}
    </ConnectionContext.Provider>
  );
};

export const useConnection = () => {
  const context = React.useContext(ConnectionContext);
  if (context === undefined) {
    throw new Error("useConnection must be used within a ConnectionProvider");
  }
  return context;
}
