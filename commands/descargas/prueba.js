import axios from "axios"
import yts from "yt-search"

export default {

command: ["yt2"],

async run({ sock, msg, from, args }) {

try {

if(!args || args.length === 0){
return sock.sendMessage(from,{
text:"❌ Escribe algo\nEjemplo:\n.yt2 bad bunny"
})
}

const query = args.join(" ")

await sock.sendMessage(from,{ text:"🔎 Buscando..." })

const search = await yts(query)
const video = search.videos[0]

if(!video){
return sock.sendMessage(from,{ text:"❌ No encontrado" })
}

const url = video.url

await sock.sendMessage(from,{ text:"⚡ Probando APIs..." })

const apis = [

`https://cdn.savetube.me/info?url=${url}`,
`https://api.vevioz.com/api/button/mp4/${url}`,
`https://loader.to/ajax/download.php?url=${url}&format=mp4`,
`https://api.yt1s.com/api/ajaxSearch/index?q=${url}&vt=home`,
`https://yt5s.io/api/ajaxSearch`,
`https://keepvid.pro/api`,
`https://y2mate.guru/api/convert`

]

let download = null

for(const api of apis){

try{

let res = await axios.get(api,{timeout:10000})

if(!res.data) continue

let link =
res.data.url ||
res.data.download ||
res.data.result ||
res.data.link ||
res.data.video

if(typeof link === "string" && link.startsWith("http")){
download = link
console.log("API FUNCIONANDO:",api)
break
}

}catch(e){
console.log("API FALLÓ:",api)
continue
}

}

if(!download){
return sock.sendMessage(from,{
text:"❌ Ninguna API devolvió video"
})
}

await sock.sendMessage(from,{
video:{ url: download },
caption:`🎬 ${video.title}`
})

}catch(e){

console.error("ERROR yt2:",e)

sock.sendMessage(from,{
text:"❌ Error en descarga"
})

}

}

}
