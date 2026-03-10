import axios from "axios"
import yts from "yt-search"

const API_BASE = "https://dvyer-api.onrender.com"
const channelInfo = global.channelInfo || {}

const AUDIO_QUALITY = "128k"
const TIMEOUT_MS = 90000

function safeFileName(name){
  return String(name || "audio")
    .replace(/[\\/:*?"<>|]/g,"")
    .slice(0,80)
}

const sleep = (ms)=> new Promise(r=>setTimeout(r,ms))

async function getYtdlAudio(url){
  for(let i=0;i<2;i++){
    try{
      const {data} = await axios.get(`${API_BASE}/ytdl`,{
        params:{
          type:"audio",
          url,
          quality:AUDIO_QUALITY,
          safe:true
        },
        timeout:TIMEOUT_MS
      })
      return data
    }catch(e){
      if(i===1) throw e
      await sleep(2500)
    }
  }
}

export default {
  command:["play2"],
  category:"descarga",

  run: async (ctx)=>{
    const {sock,from,args} = ctx
    const msg = ctx.m || ctx.msg

    if(!args.length){
      return sock.sendMessage(from,{
        text:"❌ Uso: .play2 canción\nEjemplo:\n.play2 ozuna",
        ...channelInfo
      })
    }

    try{

      // 🔎 buscar video
      const query = args.join(" ")
      const search = await yts(query)
      const video = search.videos?.[0]

      if(!video){
        return sock.sendMessage(from,{
          text:"❌ No encontré resultados",
          ...channelInfo
        })
      }

      await sock.sendMessage(from,{
        image:{url:video.thumbnail},
        caption:`🎵 *${video.title}*\n⏱️ ${video.timestamp}\n\n⬇️ Descargando audio...`,
        ...channelInfo
      },{quoted:msg})

      const data = await getYtdlAudio(video.url)

      if(!data?.status || !data?.result){
        throw new Error("API no devolvió datos")
      }

      const audioUrl =
        data.result.url ||
        data.result.download_url_full ||
        data.result.direct_url

      if(!audioUrl){
        throw new Error("API no devolvió audio")
      }

      const fileName = safeFileName(video.title)+".m4a"

      // descargar audio
      const audioBuffer = (await axios.get(audioUrl,{
        responseType:"arraybuffer",
        timeout:TIMEOUT_MS
      })).data

      // 🎧 enviar audio con metadata
      await sock.sendMessage(from,{
        audio:audioBuffer,
        mimetype:"audio/mpeg",
        fileName,
        ptt:false,
        contextInfo:{
          externalAdReply:{
            title: video.title,
            body: "YouTube Music",
            thumbnailUrl: video.thumbnail,
            mediaType:1,
            renderLargerThumbnail:true
          }
        },
        ...channelInfo
      },{quoted:msg})

    }catch(err){

      console.log("[PLAY2 ERROR]",err)

      await sock.sendMessage(from,{
        text:"❌ Error descargando música\nIntenta otra canción",
        ...channelInfo
      },{quoted:msg})

    }
  }
}