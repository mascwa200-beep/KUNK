--- harness.lua -- assertions and a runner for the Lua suites.
---
--- Deliberately tiny and dependency-free: CI installs a stock lua5.4 and
--- nothing else, so anything a test needs has to be in this repository.
local H = {}

H.checks = 0
H.failures = {}
H.currentTest = "<none>"

local function fail(message, level)
    local where = debug.getinfo((level or 3) + 1, "Sl")
    local location = where and
        (where.short_src .. ":" .. where.currentline) or "?"
    table.insert(H.failures,
        string.format("%s\n         at %s", message, location))
end

local function show(value)
    if type(value) == "string" then return string.format("%q", value) end
    if type(value) == "table" then
        local parts = {}
        for k, v in pairs(value) do
            table.insert(parts, tostring(k) .. "=" .. tostring(v))
        end
        table.sort(parts)
        return "{" .. table.concat(parts, ", ") .. "}"
    end
    return tostring(value)
end

function H.check(condition, message)
    H.checks = H.checks + 1
    if not condition then
        fail(message or "expected a truthy value")
    end
end

function H.equal(actual, expected, message)
    H.checks = H.checks + 1
    if actual ~= expected then
        fail(string.format("%s\n         actual:   %s\n         expected: %s",
            message or "values differ", show(actual), show(expected)))
    end
end

function H.near(actual, expected, tolerance, message)
    H.checks = H.checks + 1
    tolerance = tolerance or 1e-6
    if type(actual) ~= "number" or math.abs(actual - expected) > tolerance then
        fail(string.format("%s\n         actual:   %s\n         expected: %s +- %s",
            message or "values differ", show(actual), show(expected),
            show(tolerance)))
    end
end

function H.contains(haystack, needle, message)
    H.checks = H.checks + 1
    if type(haystack) ~= "string" or not haystack:find(needle, 1, true) then
        fail(string.format("%s\n         %s should contain %s",
            message or "substring missing", show(haystack), show(needle)))
    end
end

--- Asserts that `fn` does NOT raise. The whole point of Compat.lua is that a
--- missing Script Extender API degrades instead of taking the mod down, so
--- "did not throw" is a real assertion here rather than a formality.
function H.noError(fn, message)
    H.checks = H.checks + 1
    local ok, err = pcall(fn)
    if not ok then
        fail(string.format("%s\n         raised: %s",
            message or "call raised unexpectedly", tostring(err)))
    end
    return ok
end

local tests = {}

function H.test(name, fn)
    table.insert(tests, { name = name, fn = fn })
end

function H.run(suiteName)
    print("[" .. suiteName .. "]")
    local suiteFailures = 0
    for _, entry in ipairs(tests) do
        local before = #H.failures
        H.currentTest = entry.name
        local ok, err = pcall(entry.fn)
        if not ok then
            fail("test raised: " .. tostring(err), 1)
        end
        local added = #H.failures - before
        if added > 0 then
            suiteFailures = suiteFailures + 1
            print(string.format("  FAIL %s", entry.name))
            for i = before + 1, #H.failures do
                print("    " .. H.failures[i])
            end
        else
            print(string.format("  ok   %s", entry.name))
        end
    end
    tests = {}
    return suiteFailures
end

return H
