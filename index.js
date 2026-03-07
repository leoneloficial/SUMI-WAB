// =========================
// DVYER BOT - INDEX (STABLE)
// =========================

import * as baileys from "@whiskeysockets/baileys"

const makeWASocket =
(typeof baileys.makeWASocket === "function" && baileys.makeWASocket) ||
(typeof baileys.default === "function" && baileys.default) ||
(baileys.default && typeof baileys.default.makeWASocket === "function" && baileys.default.makeWASocket)

if (typeof makeWASocket !== "function") {
throw new Error("makeWASocket no compatible con este hosting")
}

const {
useMultiFileAuthState,
makeCacheableSignalKeyStore,
DisconnectReason,
fetchLatestBaileysVersion
} = baileys

import pino from "pino"
import chalk from "chalk"
import readline from "readline"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

// ================= CONFIG =================

const CARPETA_AUTH = "dvyer-session"
const logger = pino({ level: "silent" })

const settings = JSON.parse(
fs.readFileSync("./settings/settings.json","utf-8")
)

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// ================= INFO CHANNEL =================

global.channelInfo = settings?.newsletter?.enabled
? {
contextInfo:{
forwardingScore:999,
isForwarded:true,
forwardedNewsletterMessageInfo:{
newsletterJid:settings.newsletter.jid,
newsletterName:settings.newsletter.name,
serverMessageId:-1
}
}
}
: {}

// ================= TMP DIR =================

const TMP_DIR = path.join(process.cwd(),"tmp")

try{
if(!fs.existsSync(TMP_DIR)){
fs.mkdirSync(TMP_DIR,{recursive:true})
}
}catch{}

process.env.TMPDIR = TMP_DIR
process.env.TMP = TMP_DIR
process.env.TEMP = TMP_DIR

// ================= VARIABLES =================

let sockGlobal = null
let conectando = false

let rl = readline.createInterface({
input:process.stdin,
output:process.stdout
})

const preguntar = q => new Promise(r => rl.question(q,r))

const comandos = new Map()

let totalMensajes = 0
let totalComandos = 0

let mensajesPorTipo = {
Grupo:0,
Privado:0
}

// ================= CONSOLA =================

global.consoleBuffer = []
global.MAX_CONSOLE_LINES = 120

function pushConsole(level,args){

const line = `[${new Date().toLocaleString()}] [${level}] ` +
args.map(a=>{
try{
if(a instanceof Error) return a.stack
if(typeof a === "string") return a
return JSON.stringify(a)
}catch{
return String(a)
}
}).join(" ")

global.consoleBuffer.push(line)

if(global.consoleBuffer.length > global.MAX_CONSOLE_LINES){
global.consoleBuffer.shift()
}

}

const log = console.log
const error = console.error
const warn = console.warn

console.log=(...a)=>{
pushConsole("LOG",a)
log(chalk.cyan("[LOG]"),...a)
}

console.warn=(...a)=>{
pushConsole("WARN",a)
warn(chalk.yellow("[WARN]"),...a)
}

console.error=(...a)=>{

const txt = String(a[0]||"")

if(
txt.includes("Bad MAC") ||
txt.includes("SessionCipher")
){
return
}

pushConsole("ERROR",a)
error(chalk.red("[ERROR]"),...a)

}

// ================= ANTI CRASH =================

process.on("unhandledRejection",(reason)=>{

if(String(reason).includes("Bad MAC")) return

console.error(reason)

})

process.on("uncaughtException",(err)=>{

if(String(err.message).includes("Bad MAC")) return

console.error(err)

})

// ================= UTIL =================

function tipoChat(jid){

if(jid.endsWith("@g.us")) return "Grupo"
if(jid.endsWith("@s.whatsapp.net")) return "Privado"

return "Desconocido"

}

function obtenerTexto(message){

if(!message) return null

return (
message.conversation ||
message.extendedTextMessage?.text ||
message.imageMessage?.caption ||
message.videoMessage?.caption ||
null
)

}

// ================= BANNER =================

function banner(){

console.clear()

console.log(
chalk.magentaBright(`
╔══════════════════════════════╗
║        DVYER BOT v2          ║
╚══════════════════════════════╝
`)
)

console.log(
chalk.green("Owner :"),settings.ownerName,
chalk.blue("\nPrefijo :"),settings.prefix,
chalk.yellow("\nComandos cargados :"),comandos.size
)

console.log(chalk.gray("──────────────────────────────"))

}

// ================= CARGAR COMANDOS =================

async function cargarComandos(){

const base = path.join(__dirname,"commands")

async function leer(dir){

const archivos = fs.readdirSync(dir,{withFileTypes:true})

for(const a of archivos){

const ruta = path.join(dir,a.name)

if(a.isDirectory()){
await leer(ruta)
continue
}

if(!a.name.endsWith(".js")) continue

try{

const cmd = (await import(ruta)).default

if(!cmd || typeof cmd.run !== "function") continue

const nombres=[]

if(cmd.name) nombres.push(cmd.name)

if(cmd.command){

if(Array.isArray(cmd.command)) nombres.push(...cmd.command)
else nombres.push(cmd.command)

}

for(const n of nombres){
comandos.set(String(n).toLowerCase(),cmd)
}

console.log("✓ Comando cargado:",nombres.join(","))

}catch(e){

console.error("Error cargando comando",e)

}

}

}

await leer(base)

}

// ================= BOT =================

async function iniciarBot(){

if(conectando) return
conectando = true

try{

banner()

const {state,saveCreds} = await useMultiFileAuthState(CARPETA_AUTH)
const {version} = await fetchLatestBaileysVersion()

sockGlobal = makeWASocket({

version,
logger,
printQRInTerminal:false,

auth:{
creds:state.creds,
keys:makeCacheableSignalKeyStore(state.keys,logger)
}

})

const sock = sockGlobal

if(!state.creds.registered){

console.log("📲 Bot no vinculado")

const numero = await preguntar("Numero: ")

const codigo = await sock.requestPairingCode(numero.trim())

console.log("\nCODIGO DE VINCULACION:\n")
console.log(chalk.greenBright(codigo))

}

sock.ev.on("creds.update",saveCreds)

sock.ev.on("connection.update",({connection,lastDisconnect})=>{

if(connection==="open"){

console.log(chalk.green("✅ DVYER BOT CONECTADO"))

}

if(connection==="close"){

const code = lastDisconnect?.error?.output?.statusCode

console.log("Conexion cerrada:",code)

if(code===401 || code===DisconnectReason.loggedOut){

try{
fs.rmSync(CARPETA_AUTH,{recursive:true,force:true})
}catch{}

}

setTimeout(()=>{
iniciarBot()
},2000)

}

})

// ================= MENSAJES =================

sock.ev.on("messages.upsert",async({messages})=>{

const msg = messages[0]

if(!msg?.message || msg.key.fromMe) return

const from = msg.key.remoteJid
const texto = obtenerTexto(msg.message)

if(!texto) return

totalMensajes++

const tipo = tipoChat(from)

mensajesPorTipo[tipo]++

const txt = texto.trim()

const prefijo = settings.prefix || "."

if(!txt.startsWith(prefijo)) return

const body = txt.slice(prefijo.length).trim()

const args = body.split(/\s+/)

const comando = args.shift()?.toLowerCase()

const cmd = comandos.get(comando)

if(!cmd) return

totalComandos++

try{

await cmd.run({
sock,
msg,
from,
args,
settings,
comandos
})

}catch(e){

console.error("Error comando:",e)

}

})

}catch(e){

console.error(e)

}finally{

conectando=false

}

}

async function start(){

await cargarComandos()
await iniciarBot()

}

start()

process.on("SIGINT",()=>{

console.log("Bot apagado")

process.exit()

})
