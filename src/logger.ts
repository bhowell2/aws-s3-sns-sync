export enum LogLevel {
  NONE = 0,
  ERROR,
  WARN,
  DEBUG,
}

// default log level
export var GLOBAL_LOG_LEVEL = LogLevel.ERROR;

export function setLogLevelFromString(level: string) {
  switch (level.toUpperCase()) {
    case "NONE":
      setLogLevel(LogLevel.NONE)
      break;
    case "ERROR":
      setLogLevel(LogLevel.ERROR)
      break;
    case "WARN":
      setLogLevel(LogLevel.WARN)
      break;
    case "DEBUG":
      setLogLevel(LogLevel.DEBUG)
      break;
    default:
      setLogLevel(LogLevel.ERROR)
  }
}

export function setLogLevel(level: LogLevel | string) {
  if (typeof level === "string") {
    setLogLevelFromString(level);
  } else {
    console.log("Setting log level to " + LogLevel[level]+ ".")
    GLOBAL_LOG_LEVEL = level;
  }
}

export function log(msg: any, level: LogLevel) {
  if (GLOBAL_LOG_LEVEL !== LogLevel.NONE && GLOBAL_LOG_LEVEL >= level) {
    if (level === LogLevel.ERROR) {
      console.error(msg);
    } else if (level === LogLevel.WARN) {
      console.warn(msg);
    } else {
      console.log(msg)
    }
  }
}
