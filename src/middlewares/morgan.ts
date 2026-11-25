import { Request } from "express";
import morgan from "morgan";
import logger from "../utils/logger";

const morganStream = {
  write: (message: string) => {
    logger.http(message.trim());
  }
};

// The default :remote-addr token reads req.ip, which throws once a client has dropped the
// connection mid-upload (the socket is gone). Read the address defensively instead.
morgan.token("remote-addr", (req: Request) => {
  try {
    return req.ip || req.socket?.remoteAddress || "-";
  } catch {
    return "-";
  }
});

// Same as be-admin-portal: only requests that ended with status >= 400 are logged.
export const morganMiddleware = () =>
  morgan("combined", {
    stream: morganStream,
    skip: (_req, res) => res.statusCode < 400
  });
