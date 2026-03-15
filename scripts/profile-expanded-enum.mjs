#!/usr/bin/env node
import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import JSZip from 'jszip';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_URL = 'http://localhost:3000/';
const ZOOM_STEPS = 15;
const PLUGIN_LOAD_DELAY_MS = 5000;

async function createVxpkgFile() {
    const pluginCode = fs.readFileSync(path.join(__dirname, 'large-enum-plugin.js'), 'utf-8');
    const zip = new JSZip();
    zip.file('manifest.json', JSON.stringify({
        name: 'large-enum-test',
        displayName: 'Large Enum Test Signal',
        version: '1.0.0',
        voltexApiVersion: '1.0.0',
        main: 'plugin.js'
    }, null, 2));
    zip.file('plugin.js', pluginCode);
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });
    const vxpkgPath = path.join(process.cwd(), 'large-enum-test.vxpkg');
    fs.writeFileSync(vxpkgPath, buffer);
    return vxpkgPath;
}

async function loadPlugin(page, vxpkgPath) {
    const inputHandle = await page.evaluateHandle(() => {
        const input = document.createElement('input');
        input.type = 'file';
        input.id = '__vxpkg_input__';
        document.body.appendChild(input);
        return input;
    });
    await inputHandle.asElement().uploadFile(vxpkgPath);
    await page.waitForFunction(() => typeof window.__voltexDropHandler === 'function', { timeout: 10000 });

    const loaded = await page.evaluate(async () => {
        const input = document.getElementById('__vxpkg_input__');
        if (!input?.files?.length || typeof window.__voltexDropHandler !== 'function') return false;
        await window.__voltexDropHandler({
            preventDefault: () => {},
            stopPropagation: () => {},
            dataTransfer: { files: [input.files[0]] }
        });
        input.remove();
        return true;
    });
    if (!loaded) throw new Error('Failed to load plugin');
    await new Promise(r => setTimeout(r, PLUGIN_LOAD_DELAY_MS));
}

async function runZoomCycles(page, centerX, centerY) {
    const delay = ms => new Promise(r => setTimeout(r, ms));
    const pan = async (key, holdMs = 500) => {
        await page.keyboard.down(key);
        await delay(holdMs);
        await page.keyboard.up(key);
        await delay(100);
    };
    const zoom = async (deltaY, steps) => {
        for (let i = 0; i < steps; i++) {
            await page.mouse.wheel({ deltaY });
            await delay(50);
        }
    };

    await page.keyboard.press('f');
    await delay(500);

    // Zoomed in - short pans
    await zoom(-200, ZOOM_STEPS);
    await delay(500);
    await pan('d', 300);
    await pan('a', 300);

    // Mid zoom - moderate pans
    await zoom(200, Math.floor(ZOOM_STEPS / 2));
    await delay(500);
    await pan('d', 500);
    await pan('a', 500);

    // Zoom out fully
    await zoom(200, Math.ceil(ZOOM_STEPS / 2));
    await delay(500);

    await page.keyboard.press('f');
    await delay(500);

    // Zoomed out - extensive panning (this is where perf issues occur)
    for (let i = 0; i < 3; i++) {
        await pan('d', 800);
        await delay(300);
        await pan('a', 800);
        await delay(300);
    }
}

function analyzeProfile(profile) {
    const { nodes, samples, timeDeltas } = profile;
    const nodeMap = new Map();
    for (const node of nodes) {
        nodeMap.set(node.id, { ...node, selfTime: 0 });
    }

    const totalTime = timeDeltas.reduce((a, b) => a + b, 0);
    for (let i = 0; i < samples.length; i++) {
        const node = nodeMap.get(samples[i]);
        if (node) node.selfTime += timeDeltas[i];
    }

    const activeTime = Array.from(nodeMap.values())
        .filter(n => !['(idle)', '(program)'].includes(n.callFrame.functionName))
        .reduce((sum, n) => sum + n.selfTime, 0);

    const hotspots = Array.from(nodeMap.values())
        .filter(n => n.selfTime > 0 && n.callFrame.functionName &&
            !['(idle)', '(program)', '(garbage collector)'].includes(n.callFrame.functionName))
        .sort((a, b) => b.selfTime - a.selfTime)
        .slice(0, 40);

    console.log(`Total: ${(totalTime / 1000).toFixed(2)}ms, Active: ${(activeTime / 1000).toFixed(2)}ms, Samples: ${samples.length}`);
    console.log('\nTop hotspots:\n');
    console.log('Self Time (ms) | % Active | Function | Location');
    console.log('-'.repeat(110));

    for (const node of hotspots) {
        const cf = node.callFrame;
        const selfTimeMs = (node.selfTime / 1000).toFixed(2);
        const percent = ((node.selfTime / activeTime) * 100).toFixed(1);
        const location = cf.url ? `${cf.url.split('/').pop()?.split('?')[0]}:${cf.lineNumber}` : '(native)';
        console.log(`${selfTimeMs.padStart(14)} | ${percent.padStart(8)}% | ${(cf.functionName || '(anonymous)').substring(0, 45).padEnd(45)} | ${location}`);
    }

    console.log('\n\nBy source file:\n');
    const byFile = new Map();
    for (const node of nodeMap.values()) {
        if (node.selfTime > 0 && node.callFrame.url) {
            const file = node.callFrame.url.split('/').pop()?.split('?')[0] || 'unknown';
            byFile.set(file, (byFile.get(file) || 0) + node.selfTime);
        }
    }
    for (const [file, time] of [...byFile.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)) {
        console.log(`${(time / 1000).toFixed(2).padStart(10)}ms (${((time / activeTime) * 100).toFixed(1).padStart(5)}%) | ${file}`);
    }
}

async function main() {
    const vxpkgPath = await createVxpkgFile();
    console.log('Plugin created');

    const browser = await puppeteer.launch({
        headless: false,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1400, height: 900 });
    const client = await page.createCDPSession();

    await page.evaluateOnNewDocument(() => {
        const orig = EventTarget.prototype.addEventListener;
        EventTarget.prototype.addEventListener = function(type, listener, options) {
            if (type === 'drop') window.__voltexDropHandler = listener;
            return orig.call(this, type, listener, options);
        };
    });

    await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('canvas', { timeout: 10000 });
    console.log('App loaded');

    page.on('console', msg => { if (msg.type() === 'error') console.log('Browser:', msg.text()); });
    page.on('pageerror', err => console.log('Page error:', err.message));

    await loadPlugin(page, vxpkgPath);
    console.log('Plugin loaded');

    const canvas = await page.$('canvas');
    const box = await canvas.boundingBox();
    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;
    await page.mouse.click(centerX, centerY);

    console.log('Profiling...');
    await client.send('Profiler.enable');
    await client.send('Profiler.setSamplingInterval', { interval: 100 });
    await client.send('Profiler.start');

    await runZoomCycles(page, centerX, centerY);

    const { profile } = await client.send('Profiler.stop');
    const profilePath = path.join(process.cwd(), 'expanded-enum-profile.cpuprofile');
    fs.writeFileSync(profilePath, JSON.stringify(profile, null, 2));
    console.log(`Profile saved: ${profilePath}\n`);

    analyzeProfile(profile);

    await browser.close();
    fs.unlinkSync(vxpkgPath);
}

main().catch(console.error);
