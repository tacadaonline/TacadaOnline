#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const JavaScriptObfuscator = require('javascript-obfuscator');

const HTML_FILES = [
    'public/jogo.html',
    'public/painelrei777.html',
    'public/cadastro.html',
    'public/index.html',
    'jogo.html',
    'painelrei777.html',
    'cadastro.html',
    'index.html',
];

const OBFUSCATOR_OPTIONS = {
    compact: true,
    controlFlowFlattening: false,
    deadCodeInjection: false,
    debugProtection: false,
    disableConsoleOutput: false,
    identifierNamesGenerator: 'hexadecimal',
    renameGlobals: false,
    rotateStringArray: true,
    selfDefending: false,
    shuffleStringArray: true,
    splitStrings: false,
    stringArray: true,
    stringArrayEncoding: ['base64'],
    stringArrayThreshold: 0.75,
    unicodeEscapeSequence: false,
};

// Matches inline <script> tags that contain JavaScript:
// - no src attribute
// - no type attribute, OR type="text/javascript", OR type="module"
const SCRIPT_BLOCK_RE = /<script((?![^>]*\bsrc\b)[^>]*)>([\s\S]*?)<\/script>/gi;

const JS_TYPE_RE = /\btype\s*=\s*["']([^"']+)["']/i;

function isJavaScriptScript(attrs) {
    const match = attrs.match(JS_TYPE_RE);
    if (!match) return true; // no type attribute → JavaScript by default
    const type = match[1].toLowerCase();
    return type === 'text/javascript' || type === 'module' || type === 'application/javascript';
}

function obfuscateHtmlFile(filePath) {
    const abs = path.resolve(filePath);
    if (!fs.existsSync(abs)) {
        console.warn(`Skipping (not found): ${filePath}`);
        return;
    }

    let html = fs.readFileSync(abs, 'utf8');
    let modified = false;

    html = html.replace(SCRIPT_BLOCK_RE, (match, attrs, jsContent) => {
        if (!isJavaScriptScript(attrs)) return match;
        const trimmed = jsContent.trim();
        if (!trimmed) return match;
        try {
            const result = JavaScriptObfuscator.obfuscate(trimmed, OBFUSCATOR_OPTIONS);
            const obfuscated = result.getObfuscatedCode();
            modified = true;
            return match.replace(jsContent, `\n${obfuscated}\n`);
        } catch (err) {
            console.warn(`  Warning: could not obfuscate a script block in ${filePath}: ${err.message}`);
            return match;
        }
    });

    if (modified) {
        fs.writeFileSync(abs, html, 'utf8');
        console.log(`Obfuscated: ${filePath}`);
    } else {
        console.log(`No inline scripts found: ${filePath}`);
    }
}

HTML_FILES.forEach(obfuscateHtmlFile);
console.log('Done.');
