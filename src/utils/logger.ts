import { addColors, createLogger, format, transports } from "winston";
import DailyRotateFile from "winston-daily-rotate-file";

// Same levels, colours and rotation as be-admin-portal's logger.
const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4
};

const level = () => {
  if (process.env.SPECIFIC_LOGS === "Active") return "warn";
  return (process.env.NODE_ENV || "development") === "development" ? "debug" : "info";
};

addColors({
  error: "red",
  warn: "yellow",
  info: "green",
  http: "magenta",
  debug: "white"
});

const line = format.printf((info) => {
  const meta = info.meta ? ` ${JSON.stringify(info.meta)}` : "";
  return `${info.timestamp} ${info.level}: ${info.message}${meta}`;
});
const timestamp = format.timestamp({ format: "YYYY-MM-DD HH:mm:ss:ms" });

const logger = createLogger({
  level: level(),
  levels,
  format: format.combine(timestamp, line),
  transports: [
    // Colours only on the console, so the log files stay plain text.
    new transports.Console({ format: format.combine(timestamp, format.colorize({ all: true }), line) }),
    new DailyRotateFile({
      filename: "logs/error-%DATE%.log",
      datePattern: "YYYY-MM-DD",
      level: "error",
      zippedArchive: true,
      maxSize: "20m",
      maxFiles: "14d"
    }),
    new DailyRotateFile({
      filename: "logs/all-%DATE%.log",
      datePattern: "YYYY-MM-DD",
      zippedArchive: true,
      maxSize: "20m",
      maxFiles: "14d"
    })
  ]
});

export default logger;
