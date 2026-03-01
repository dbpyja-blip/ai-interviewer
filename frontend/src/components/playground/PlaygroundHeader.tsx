import { Button } from "@/components/button/Button";
import { LoadingSVG } from "@/components/button/LoadingSVG";

import { useConfig } from "@/hooks/useConfig";
import { ConnectionState, LocalParticipant } from "livekit-client";
import { ReactNode } from "react";
import { MicIcon, MicOffIcon, CameraIcon, CameraOffIcon, ChatIcon, PhoneIcon, ScreenShareIcon, CodeIcon } from "./icons";
import { useLocalParticipant } from "@livekit/components-react";

type PlaygroundHeader = {
  logo?: ReactNode;
  title?: ReactNode;
  githubLink?: string;
  height: number;
  accentColor: string;
  connectionState: ConnectionState;
  onConnectClicked: () => void;
  onChatToggle?: () => void;
  onEndCall?: () => void;
  onCodeEditorOpen?: () => void;
};

export const PlaygroundHeader = ({
  logo,
  title,
  githubLink,
  accentColor,
  height,
  onConnectClicked,
  connectionState,
  onChatToggle,
  onEndCall,
  onCodeEditorOpen,
}: PlaygroundHeader) => {
  const { config, setUserSettings } = useConfig();
  const { localParticipant } = useLocalParticipant();
  
  const toggleMicrophone = async () => {
    if (localParticipant instanceof LocalParticipant) {
      const enabled = !localParticipant.isMicrophoneEnabled;
      await localParticipant.setMicrophoneEnabled(enabled);
      
      // Update settings
      setUserSettings({
        ...config.settings,
        inputs: {
          ...config.settings.inputs,
          mic: enabled
        }
      });
    }
  };

  const toggleCamera = async () => {
    if (localParticipant instanceof LocalParticipant) {
      const enabled = !localParticipant.isCameraEnabled;
      await localParticipant.setCameraEnabled(enabled);
      
      // Update settings
      setUserSettings({
        ...config.settings,
        inputs: {
          ...config.settings.inputs,
          camera: enabled
        }
      });
    }
  };

  const toggleScreenShare = async () => {
    if (localParticipant instanceof LocalParticipant) {
      const enabled = !localParticipant.isScreenShareEnabled;
      try {
        await localParticipant.setScreenShareEnabled(enabled);
        
        // Update settings if needed
        setUserSettings({
          ...config.settings,
          inputs: {
            ...config.settings.inputs,
            screenShare: enabled
          }
        });
      } catch (error) {
        console.error('Failed to toggle screen share:', error);
      }
    }
  };

  const toggleChat = () => {
    // Update settings
    setUserSettings({
      ...config.settings,
      chat: !config.settings.chat
    });
    
    if (onChatToggle) {
      onChatToggle();
    }
  };

  const isConnected = connectionState === ConnectionState.Connected;
  const isConnecting = connectionState === ConnectionState.Connecting;
  
  return (
    <div
      className="flex gap-4 pt-4 justify-between items-center shrink-0"
      style={{
        height: height + "px",
      }}
    >
      <div className="flex items-center gap-3 basis-1/3 min-w-0">
        {/* Always show the SkillCef branded logo — never the passed-in prop logo
            which was the old LiveKit/Vercel playground logo */}
        <SkillCefLogo />
        <div className="lg:text-center text-base lg:text-xl lg:font-semibold text-white truncate">
          SkillCef AI Interviewer
        </div>
      </div>
      <div className="flex items-center basis-1/3 justify-center">
        {isConnecting && (
          <div className="flex items-center gap-2 text-white text-sm">
            <LoadingSVG diameter={16} strokeWidth={2} />
            <span>Connecting...</span>
          </div>
        )}
      </div>
      <div className="flex basis-1/3 justify-end items-center gap-2 shrink-0">
        {isConnected && (
          <>
            <Button 
              accentColor={localParticipant?.isMicrophoneEnabled ? accentColor : "gray"}
              onClick={toggleMicrophone}
              className="shrink-0 hover:bg-gray-100 dark:hover:bg-opacity-80"
              variant="icon"
            >
              {localParticipant?.isMicrophoneEnabled ? <MicIcon /> : <MicOffIcon />}
            </Button>
            
            <Button 
              accentColor={localParticipant?.isCameraEnabled ? accentColor : "gray"}
              onClick={toggleCamera}
              className="shrink-0 hover:bg-gray-100 dark:hover:bg-opacity-80"
              variant="icon"
            >
              {localParticipant?.isCameraEnabled ? <CameraIcon /> : <CameraOffIcon />}
            </Button>

            {/* Screen Share Button - Commented out - Replaced with Code Editor
            <Button 
              accentColor={localParticipant?.isScreenShareEnabled ? accentColor : "gray"}
              onClick={toggleScreenShare}
              className="shrink-0 hover:bg-gray-100 dark:hover:bg-opacity-80"
              variant="icon"
            >
              <ScreenShareIcon />
            </Button>
            */}
            
            {/* Code Editor Button */}
            <Button 
              accentColor={accentColor}
              onClick={onCodeEditorOpen}
              className="shrink-0 hover:bg-gray-100 dark:hover:bg-opacity-80"
              variant="icon"
              title="Open Code Editor"
            >
              <CodeIcon />
            </Button>
            
            <Button 
              accentColor={config.settings.chat ? accentColor : "gray"}
              onClick={toggleChat}
              className="shrink-0 hover:bg-gray-100 dark:hover:bg-opacity-80"
              variant="icon"
            >
              <ChatIcon />
            </Button>
          </>
        )}

        {/* GitHub link removed — not relevant for SkillCef AI Interviewer */}
        
        <Button
          accentColor={isConnected ? "red" : "green"}
          disabled={isConnecting}
          onClick={() => {
            if (isConnected && onEndCall) {
              onEndCall();
            } else {
              onConnectClicked();
            }
          }}
          className="shrink-0 hover:bg-gray-100 dark:hover:bg-opacity-80"
          variant="icon"
        >
          {isConnecting ? <LoadingSVG /> : <PhoneIcon />}
        </Button>
      </div>
    </div>
  );
};

/**
 * SkillCef AI Interviewer logo mark — used in the playground header.
 * A cyan rounded square containing a person silhouette with AI-spark nodes,
 * representing an AI-powered interview session.
 */
const SkillCefLogo = () => (
  <svg
    width="28"
    height="28"
    viewBox="0 0 32 32"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-label="SkillCef AI Interviewer"
  >
    {/* Cyan background square */}
    <rect width="32" height="32" rx="7" fill="#06B6D4" />
    {/* Person head */}
    <circle cx="15" cy="11" r="4" fill="white" />
    {/* Person shoulders */}
    <path
      d="M7 27c0-4.418 3.582-8 8-8s8 3.582 8 8"
      stroke="white"
      strokeWidth="2.2"
      strokeLinecap="round"
    />
    {/* AI spark node 1 — large dot top-right */}
    <circle cx="23" cy="7" r="1.7" fill="white" opacity="0.9" />
    {/* AI spark connector line to head */}
    <line
      x1="21.3" y1="8.2"
      x2="19.5" y2="9.8"
      stroke="white"
      strokeWidth="1.2"
      strokeLinecap="round"
      opacity="0.85"
    />
    {/* AI spark node 2 — small dot further right */}
    <circle cx="25.5" cy="12" r="1.1" fill="white" opacity="0.65" />
    {/* AI spark connector line 2 */}
    <line
      x1="23.5" y1="8.6"
      x2="24.7" y2="11"
      stroke="white"
      strokeWidth="1.1"
      strokeLinecap="round"
      opacity="0.65"
    />
  </svg>
);
