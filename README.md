# Bot VIP

## Ejecutar localmente

```bash
npm install
npm start
```

## Validar sintaxis

```bash
npm run check
```

## Trabajo en Visual Studio Code (ver cambios)

1. Abre la carpeta del proyecto en VS Code:
   - `File > Open Folder...` y selecciona este repositorio.
2. Ve a la pestaña **Source Control** (icono de rama).
3. Ahí verás todos los archivos modificados, nuevos o eliminados.
4. Haz clic en un archivo para ver el diff línea por línea.
5. Para confirmar cambios:
   - Stage (`+`), escribe mensaje de commit y presiona **Commit**.

También puedes usar terminal integrada de VS Code:

```bash
git status
git diff
```

## Variables de entorno de seguridad (admin)

- `ALLOW_OWNER_EVAL=true` habilita el comando `.eval`.
- `ALLOW_OWNER_EXEC=true` habilita el comando `.exec`.
- `MEDIAFIRE_API_KEY=<tu_clave>` define la clave de Mediafire sin hardcodearla.

> Recomendado en producción: dejar `ALLOW_OWNER_EVAL` y `ALLOW_OWNER_EXEC` en `false` (o sin definir).
