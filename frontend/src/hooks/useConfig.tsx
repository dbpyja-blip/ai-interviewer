"use client";

import { getCookie, setCookie } from "cookies-next";
import jsYaml from "js-yaml";
// IMPORTANT: use "next/router" (Pages Router), NOT "next/navigation" (App Router).
// Using "next/navigation" caused an infinite router.replace() loop that
// reloaded the page every 1-2 minutes and bounced the user back to the welcome screen.
import React, {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

export type AppConfig = {
  title: string;
  description: string;
  github_link?: string;
  video_fit?: "cover" | "contain";
  settings: UserSettings;
  show_qr?: boolean;
};

export type UserSettings = {
  editable: boolean;
  theme_color: string;
  chat: boolean;
  inputs: {
    camera: boolean;
    mic: boolean;
    screenShare: boolean;
  };
  outputs: {
    audio: boolean;
    video: boolean;
  };
  ws_url: string;
  token: string;
  room_name: string;
  participant_name: string;
};

// Fallback if NEXT_PUBLIC_APP_CONFIG is not set
const defaultConfig: AppConfig = {
  title: "SkillCef AI Interviewer",
  description: "Practice interviews with SkillCef AI",
  video_fit: "cover",
  settings: {
    editable: true,
    theme_color: "cyan",
    chat: true,
    inputs: {
      camera: true,
      mic: true,
      screenShare: false
    },
    outputs: {
      audio: true,
      video: true,
    },
    ws_url: "",
    token: "",
    room_name: "",
    participant_name: "",
  },
  show_qr: false,
};

const useAppConfig = (): AppConfig => {
  return useMemo(() => {
    if (process.env.NEXT_PUBLIC_APP_CONFIG) {
      try {
        const parsedConfig = jsYaml.load(
          process.env.NEXT_PUBLIC_APP_CONFIG
        ) as AppConfig;
        if (parsedConfig.settings === undefined) {
          parsedConfig.settings = defaultConfig.settings;
        }
        if (parsedConfig.settings.editable === undefined) {
          parsedConfig.settings.editable = true;
        }
        return parsedConfig;
      } catch (e) {
        console.error("Error parsing app config:", e);
      }
    }
    return defaultConfig;
  }, []);
};

type ConfigData = {
  config: AppConfig;
  setUserSettings: (settings: UserSettings) => void;
};

const ConfigContext = createContext<ConfigData | undefined>(undefined);

export const ConfigProvider = ({ children }: { children: React.ReactNode }) => {
  const appConfig = useAppConfig();
  const [localColorOverride, setLocalColorOverride] = useState<string | null>(
    null
  );

  // Read settings from cookies only — URL hash is never read or written.
  // Writing to the URL hash was the root cause of the infinite reload loop:
  // getConfig() called setUrlSettings() which triggered router.replace() which
  // re-rendered the component which called getConfig() again, indefinitely.
  const getSettingsFromCookies = useCallback(() => {
    const appConfigFromSettings = appConfig;
    if (appConfigFromSettings.settings.editable === false) {
      return null;
    }
    const jsonSettings = getCookie("lk_settings");
    if (!jsonSettings) {
      return null;
    }
    return JSON.parse(jsonSettings) as UserSettings;
  }, [appConfig]);

  // Save settings to cookie only — never touch the URL.
  const setCookieSettings = useCallback((us: UserSettings) => {
    const json = JSON.stringify(us);
    setCookie("lk_settings", json);
  }, []);

  // Pure read-only function: reads cookies, falls back to app defaults.
  // Does NOT call router.replace() or write to the URL — no side effects.
  const getConfig = useCallback(() => {
    const appConfigFromSettings = appConfig;

    if (appConfigFromSettings.settings.editable === false) {
      if (localColorOverride) {
        appConfigFromSettings.settings.theme_color = localColorOverride;
      }
      return appConfigFromSettings;
    }

    const cookieSettings = getSettingsFromCookies();
    if (!cookieSettings) {
      return appConfigFromSettings;
    }

    appConfigFromSettings.settings = cookieSettings;
    return { ...appConfigFromSettings };
  }, [appConfig, getSettingsFromCookies, localColorOverride]);

  // Update settings: save to cookie + update React state. No URL involvement.
  const setUserSettings = useCallback(
    (settings: UserSettings) => {
      const appConfigFromSettings = appConfig;
      if (appConfigFromSettings.settings.editable === false) {
        setLocalColorOverride(settings.theme_color);
        return;
      }
      setCookieSettings(settings);
      _setConfig((prev: AppConfig) => {
        return {
          ...prev,
          settings: settings,
        };
      });
    },
    [appConfig, setCookieSettings]
  );

  const [config, _setConfig] = useState<AppConfig>(getConfig());

  // Re-read config once on the client side (cookies are only available client-side).
  useEffect(() => {
    _setConfig(getConfig());
  }, [getConfig]);

  return (
    <ConfigContext.Provider value={{ config, setUserSettings }}>
      {children}
    </ConfigContext.Provider>
  );
};

export const useConfig = () => {
  const context = React.useContext(ConfigContext);
  if (context === undefined) {
    throw new Error("useConfig must be used within a ConfigProvider");
  }
  return context;
};
