#!/usr/bin/env node
'use strict'
const fs = require('node:fs')
const net = require('node:net')
const os = require('node:os')
const path = require('node:path')

const root = path.resolve(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'))
let rendezvous
try { rendezvous = JSON.parse(fs.readFileSync(path.join(root, 'browser', 'chrome', 'rendezvous.json'), 'utf8')) } catch { process.exit(2) }
const socket = net.createConnection(rendezvous.endpoint)
let nativeBuffer = Buffer.alloc(0); let socketBuffer = ''
function writeNative(value) { const body = Buffer.from(JSON.stringify(value)); const header = Buffer.alloc(4); header.writeUInt32LE(body.length, 0); process.stdout.write(Buffer.concat([header, body])) }
socket.once('connect', () => socket.write(`${JSON.stringify({ kind: 'hello', token: rendezvous.token })}\n`))
socket.setEncoding('utf8')
socket.on('data', chunk => { socketBuffer += chunk; for (;;) { const newline = socketBuffer.indexOf('\n'); if (newline < 0) break; const line = socketBuffer.slice(0, newline); socketBuffer = socketBuffer.slice(newline + 1); if (line) { try { writeNative(JSON.parse(line)) } catch {} } } })
socket.on('error', () => process.exit(3)); socket.on('close', () => process.exit(0))
process.stdin.on('data', chunk => { nativeBuffer = Buffer.concat([nativeBuffer, chunk]); for (;;) { if (nativeBuffer.length < 4) break; const size = nativeBuffer.readUInt32LE(0); if (size > 4_000_000) process.exit(4); if (nativeBuffer.length < size + 4) break; const body = nativeBuffer.subarray(4, size + 4); nativeBuffer = nativeBuffer.subarray(size + 4); socket.write(`${body.toString('utf8')}\n`) } })
process.stdin.on('end', () => socket.end())
