import yts from 'yt-search'

function getPrefix(settings) {
  if (Array.isArray(settings?.prefix)) {
    return settings.prefix.find((value) => String(value || '').trim()) || '.'
  }

  return String(settings?.prefix || '.').trim() || '.'
}

function clipText(value = '', max = 72) {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
  if (text.length <= max) return text
  return `${text.slice(0, Math.max(1, max - 3))}...`
}

function buildCommand(prefix, command, url) {
  return `${prefix}${command} ${url}`.trim()
}

export default {
  name: 'play',
  command: ['play'],
  category: 'descarga',

  async run(ctx) {
    const { sock: conn, m, from, args, settings } = ctx
    const prefix = getPrefix(settings)

    try {
      const query = Array.isArray(args) ? args.join(' ').trim() : ''

      if (!query) {
        return await conn.sendMessage(
          from,
          { text: `Ejemplo:\n${prefix}play ozuna odisea` },
          { quoted: m }
        )
      }

      const res = await yts(query)
      const videos = Array.isArray(res?.videos) ? res.videos.slice(0, 10) : []

      if (!videos.length) {
        return await conn.sendMessage(
          from,
          { text: 'No encontré resultados.' },
          { quoted: m }
        )
      }

      let thumbBuffer = null
      try {
        if (videos[0]?.thumbnail) {
          const response = await fetch(videos[0].thumbnail)
          const arrayBuffer = await response.arrayBuffer()
          thumbBuffer = Buffer.from(arrayBuffer)
        }
      } catch (e) {
        console.error('Error descargando thumbnail:', e)
      }

      const mp3Rows = videos.map((v, i) => ({
        header: `${i + 1}`,
        title: clipText(v.title || 'Sin titulo', 72),
        description: clipText(`MP3 | ${v.timestamp || '??:??'} | ${v.author?.name || 'Desconocido'}`, 72),
        id: buildCommand(prefix, 'ytmp3', v.url)
      }))

      const mp4Rows = videos.map((v, i) => ({
        header: `${i + 1}`,
        title: clipText(v.title || 'Sin titulo', 72),
        description: clipText(`MP4 | ${v.timestamp || '??:??'} | ${v.author?.name || 'Desconocido'}`, 72),
        id: buildCommand(prefix, 'ytmp4', v.url)
      }))

      if (thumbBuffer) {
        await conn.sendMessage(
          from,
          {
            image: thumbBuffer,
            caption:
              `🎵 *FSOCIETY BOT*\n\n` +
              `🔎 Resultado para: *${query}*\n` +
              `📌 Primer resultado: *${videos[0].title}*\n\n` +
              `Elige MP3 para descargar audio directo.`
          },
          { quoted: m }
        )
      } else {
        await conn.sendMessage(
          from,
          {
            text:
              `🎵 *FSOCIETY BOT*\n\n` +
              `🔎 Resultado para: *${query}*\n\n` +
              `Elige MP3 para descargar audio directo.`
          },
          { quoted: m }
        )
      }

      return await conn.sendMessage(
        from,
        {
          text: `Resultados para: ${query}`,
          title: 'FSOCIETY BOT',
          subtitle: 'YouTube MP3 / MP4',
          footer: 'Descargas YouTube',
          interactiveButtons: [
            {
              name: 'single_select',
              buttonParamsJson: JSON.stringify({
                title: 'Elegir descarga',
                sections: [
                  {
                    title: 'MP3 - Audio rapido',
                    rows: mp3Rows
                  },
                  {
                    title: 'MP4 - Video',
                    rows: mp4Rows
                  }
                ]
              })
            }
          ]
        },
        { quoted: m }
      )
    } catch (e) {
      console.error('Error en ysearch:', e)

      return await conn.sendMessage(
        from,
        { text: `Error en ysearch:\n${e?.message || e}` },
        { quoted: m }
      )
    }
  }
}
