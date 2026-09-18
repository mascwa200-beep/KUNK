--- Log.lua -- prefixed, level-filtered console output.
---
--- Script Extender's print functions differ slightly between versions, so every
--- call is resolved once and cached. If none of them exists we fall back to the
--- plain Lua print rather than erroring out of the whole mod.
local Log = {}

local PREFIX = "[FPCameraMod] "

local ORDER = { trace = 0, debug = 1, info = 2, warn = 3, error = 4, off = 5 }

Log.level = "info"

local function resolvePrinters()
    local plain, warn, err = print, print, print
    if Ext and Ext.Utils then
        plain = Ext.Utils.Print or plain
        warn = Ext.Utils.PrintWarning or plain
        err = Ext.Utils.PrintError or plain
    end
    return plain, warn, err
end

local printPlain, printWarn, printError = resolvePrinters()

local function shouldLog(level)
    return (ORDER[level] or 2) >= (ORDER[Log.level] or 2)
end

local function emit(printer, level, fmt, ...)
    if not shouldLog(level) then return end
    local ok, message = pcall(string.format, fmt, ...)
    if not ok then
        -- A bad format string in a log call must never take down the caller.
        message = tostring(fmt)
    end
    printer(PREFIX .. message)
end

function Log.Trace(fmt, ...) emit(printPlain, "trace", fmt, ...) end
function Log.Debug(fmt, ...) emit(printPlain, "debug", fmt, ...) end
function Log.Info(fmt, ...)  emit(printPlain, "info", fmt, ...) end
function Log.Warn(fmt, ...)  emit(printWarn, "warn", fmt, ...) end
function Log.Error(fmt, ...) emit(printError, "error", fmt, ...) end

--- Logs `fmt` at most once per unique `key`. Used for "this API is missing on
--- your Script Extender version" notices, which would otherwise repeat every
--- tick and drown the console.
local seen = {}
function Log.Once(key, level, fmt, ...)
    if seen[key] then return end
    seen[key] = true
    local fn = Log[level] or Log.Info
    fn(fmt, ...)
end

return Log
