--- json.lua -- a small JSON encoder/decoder for the mock Ext.Json.
---
--- Script Extender provides Ext.Json in game. The tests need an equivalent so
--- the bridge can be exercised end to end -- encoding a payload, writing it,
--- reading it back and decoding it -- rather than passing Lua tables around and
--- pretending that proves the serialisation works.
local json = {}

-- ---------- encoding ----------

local escapes = {
    ['"'] = '\\"', ['\\'] = '\\\\', ['\b'] = '\\b', ['\f'] = '\\f',
    ['\n'] = '\\n', ['\r'] = '\\r', ['\t'] = '\\t',
}

local function escapeString(s)
    return '"' .. s:gsub('[%z\1-\31\\"]', function(c)
        return escapes[c] or string.format('\\u%04x', c:byte())
    end) .. '"'
end

local function isArray(t)
    local count = 0
    for key in pairs(t) do
        if type(key) ~= "number" then return false end
        count = count + 1
    end
    return count == #t
end

local function encodeValue(value)
    local kind = type(value)
    if value == nil then return "null" end
    if kind == "boolean" then return tostring(value) end
    if kind == "number" then
        if value ~= value or value == math.huge or value == -math.huge then
            return "null"  -- JSON has no NaN or infinity
        end
        if math.type(value) == "integer" then return tostring(value) end
        return string.format("%.14g", value)
    end
    if kind == "string" then return escapeString(value) end
    if kind == "table" then
        local parts = {}
        if isArray(value) then
            for _, item in ipairs(value) do
                table.insert(parts, encodeValue(item))
            end
            return "[" .. table.concat(parts, ",") .. "]"
        end
        local keys = {}
        for key in pairs(value) do table.insert(keys, tostring(key)) end
        table.sort(keys)  -- deterministic output makes failures readable
        for _, key in ipairs(keys) do
            local raw = value[key]
            if raw == nil then raw = value[tonumber(key)] end
            table.insert(parts, escapeString(key) .. ":" .. encodeValue(raw))
        end
        return "{" .. table.concat(parts, ",") .. "}"
    end
    error("cannot encode a value of type " .. kind)
end

function json.encode(value)
    return encodeValue(value)
end

-- ---------- decoding ----------

local Parser = {}
Parser.__index = Parser

function Parser.new(text)
    return setmetatable({ text = text, pos = 1 }, Parser)
end

function Parser:error(message)
    error(string.format("json: %s at offset %d", message, self.pos), 0)
end

function Parser:skipSpace()
    local _, stop = self.text:find("^[ \t\r\n]*", self.pos)
    self.pos = stop + 1
end

function Parser:peek()
    return self.text:sub(self.pos, self.pos)
end

function Parser:expect(character)
    if self:peek() ~= character then
        self:error("expected '" .. character .. "'")
    end
    self.pos = self.pos + 1
end

function Parser:parseValue()
    self:skipSpace()
    local c = self:peek()
    if c == "" then self:error("unexpected end of input") end
    if c == "{" then return self:parseObject() end
    if c == "[" then return self:parseArray() end
    if c == '"' then return self:parseString() end
    if self.text:find("^true", self.pos) then self.pos = self.pos + 4; return true end
    if self.text:find("^false", self.pos) then self.pos = self.pos + 5; return false end
    if self.text:find("^null", self.pos) then self.pos = self.pos + 4; return nil end
    return self:parseNumber()
end

function Parser:parseNumber()
    local start, stop = self.text:find("^-?%d+%.?%d*[eE]?[-+]?%d*", self.pos)
    if not start then self:error("malformed number") end
    local number = tonumber(self.text:sub(start, stop))
    if not number then self:error("malformed number") end
    self.pos = stop + 1
    return number
end

function Parser:parseString()
    self:expect('"')
    local out = {}
    while true do
        local c = self:peek()
        if c == "" then self:error("unterminated string") end
        self.pos = self.pos + 1
        if c == '"' then break end
        if c == "\\" then
            local escape = self:peek()
            self.pos = self.pos + 1
            if escape == "n" then table.insert(out, "\n")
            elseif escape == "t" then table.insert(out, "\t")
            elseif escape == "r" then table.insert(out, "\r")
            elseif escape == "b" then table.insert(out, "\b")
            elseif escape == "f" then table.insert(out, "\f")
            elseif escape == "u" then
                local hex = self.text:sub(self.pos, self.pos + 3)
                self.pos = self.pos + 4
                table.insert(out, utf8.char(tonumber(hex, 16) or 63))
            else table.insert(out, escape) end
        else
            table.insert(out, c)
        end
    end
    return table.concat(out)
end

function Parser:parseObject()
    self:expect("{")
    local out = {}
    self:skipSpace()
    if self:peek() == "}" then self.pos = self.pos + 1; return out end
    while true do
        self:skipSpace()
        local key = self:parseString()
        self:skipSpace()
        self:expect(":")
        out[key] = self:parseValue()
        self:skipSpace()
        local c = self:peek()
        if c == "," then self.pos = self.pos + 1
        elseif c == "}" then self.pos = self.pos + 1; break
        else self:error("expected ',' or '}'") end
    end
    return out
end

function Parser:parseArray()
    self:expect("[")
    local out = {}
    self:skipSpace()
    if self:peek() == "]" then self.pos = self.pos + 1; return out end
    while true do
        table.insert(out, self:parseValue())
        self:skipSpace()
        local c = self:peek()
        if c == "," then self.pos = self.pos + 1
        elseif c == "]" then self.pos = self.pos + 1; break
        else self:error("expected ',' or ']'") end
    end
    return out
end

--- Raises on malformed input, like Ext.Json.Parse does, so the mod's pcall
--- guards are genuinely exercised.
function json.decode(text)
    local parser = Parser.new(text)
    local value = parser:parseValue()
    parser:skipSpace()
    if parser.pos <= #parser.text then parser:error("trailing content") end
    return value
end

return json
