import axios from "axios";
import yts from "yt-search";

const API = "https://0f80537128db9987-201-230-121-168.serveousercontent.com/ytmp4";

const channelInfo = global.channelInfo || {};

function safeFileName(name){
return String(name||"audio")
.replace(/[\\/:*?"<>|]/g,"")
.slice(0,80)
}

export default {

command:["ytmp3yer"],
category:"descarga",

run: async(ctx)=>{

const {sock,from,args} = ctx;
const msg = ctx.m || ctx.msg;

if(!args.length){
return sock.sendMessage(from,{
text:"❌ Uso: .ytmp3yer canción",
...channelInfo
});
}

try{

const query = args.join(" ");

const search = await yts(query);

const video = search.videos[0];

if(!video){
return sock.sendMessage(from,{
text:"❌ No encontré resultados",
...channelInfo
});
}

await sock.sendMessage(from,{
image:{url:video.thumbnail},
caption:`🎵 Descargando...\n\n${video.title}`,
...channelInfo
},{quoted:msg});

const {data} = await axios.get(API,{
params:{url:video.url},
timeout:20000
});

if(!data?.download){
throw new Error("API sin audio");
}

const audioUrl = data.download;

await sock.sendMessage(from,{
audio:{ url: audioUrl },
mimetype:"audio/mpeg",
fileName:safeFileName(video.title)+".mp3",
...channelInfo
},{quoted:msg});

}catch(err){

console.log("YTMP3YER ERROR:",err);

sock.sendMessage(from,{
text:"❌ Error descargando música",
...channelInfo
});

}

}

};
