import { NextApiRequest, NextApiResponse } from "next";
import { generateRandomAlphanumeric } from "@/lib/util";

import { AccessToken } from "livekit-server-sdk";
import type { AccessTokenOptions, VideoGrant } from "livekit-server-sdk";
import { TokenResult } from "../../lib/types";

const apiKey = process.env.LIVEKIT_API_KEY;
const apiSecret = process.env.LIVEKIT_API_SECRET;

// Token is valid for 6 hours — long enough to cover any real interview session.
// Without an explicit TTL the default is only 6 minutes which caused "token expired"
// disconnects mid-interview.
const TOKEN_TTL_SECONDS = 6 * 60 * 60; // 21600 seconds

const createToken = (userInfo: AccessTokenOptions, grant: VideoGrant) => {
  const at = new AccessToken(apiKey, apiSecret, userInfo, {
    ttl: TOKEN_TTL_SECONDS,
  });
  at.addGrant(grant);
  return at.toJwt();
};

export default async function handleToken(
  req: NextApiRequest,
  res: NextApiResponse
) {
  try {
    if (!apiKey || !apiSecret) {
      console.error("❌ LIVEKIT_API_KEY or LIVEKIT_API_SECRET is not set in environment");
      res.statusMessage = "Environment variables aren't set up correctly";
      res.status(500).end();
      return;
    }

    // The roomName query param is the sessionId generated in InterviewForm.tsx.
    // Every user gets their own unique room so sessions are fully isolated.
    const roomName = req.query.roomName as string;
    
    if (!roomName) {
      // Fallback: generate a random room name if somehow the client didn't send one.
      // This should not happen in normal flow but prevents a hard error.
      console.warn("⚠️ /api/token called without roomName — generating a fallback room name");
    }
    
    const finalRoomName = roomName ||
      `room-${generateRandomAlphanumeric(4)}-${generateRandomAlphanumeric(4)}-${generateRandomAlphanumeric(4)}`;

    // Participant identity from query or a random fallback
    const identity = req.query.participantName as string ||
      `user-${generateRandomAlphanumeric(4)}`;

    const grant: VideoGrant = {
      room: finalRoomName,
      roomJoin: true,
      canPublish: true,
      canPublishData: true,
      canSubscribe: true,
    };

    console.log(`🎫 Generating LiveKit token | room: ${finalRoomName} | identity: ${identity} | TTL: ${TOKEN_TTL_SECONDS}s`);

    const token = await createToken({ identity }, grant);
    const result: TokenResult = {
      identity,
      accessToken: token,
    };

    res.status(200).json(result);
  } catch (e) {
    console.error("❌ Token generation error:", e);
    res.statusMessage = (e as Error).message;
    res.status(500).end();
  }
}
