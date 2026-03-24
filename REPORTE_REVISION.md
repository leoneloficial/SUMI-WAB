# Revisión técnica del repositorio

Fecha de revisión: 2026-03-24

## Alcance

- Se revisaron los archivos JavaScript/CJS del repositorio (`124` archivos, ~`22,100` líneas).
- Se ejecutó validación de sintaxis para todos los archivos JS/CJS.
- Se hizo una revisión estática enfocada en seguridad, mantenibilidad y operabilidad.

## Resultado ejecutivo

El proyecto está funcional a nivel de sintaxis y tiene una estructura modular por dominios (`commands/*`, `lib/*`, `settings/*`, `database/*`), pero presenta **riesgos altos de seguridad operacional** por comandos administrativos que permiten ejecución arbitraria de código/shell si el canal owner se ve comprometido, además de una **clave API hardcodeada**.

## Hallazgos prioritarios

### 1) Riesgo crítico: ejecución arbitraria con `.eval`

- Existe ejecución dinámica de código con `eval` en el comando administrativo.
- Aunque está marcado como `ownerOnly`, el impacto sigue siendo crítico ante robo de sesión/token, error de configuración o suplantación del canal admin.

Referencia:
- `commands/admin/eval.js` usa `await eval(...)` directamente.

Recomendación:
- Mantener este comando deshabilitado por defecto en producción.
- Habilitarlo solo por variable de entorno explícita (`ENABLE_EVAL=false` por defecto).
- Registrar auditoría de uso (quién, cuándo, hash del comando).

### 2) Riesgo crítico: ejecución arbitraria de shell con `.exec`

- El comando `.exec` permite ejecutar comandos del sistema vía `child_process.exec` con entrada libre.
- Mismo riesgo operativo crítico que `.eval`, incluso mayor por acceso al sistema.

Referencia:
- `commands/admin/exec.js` invoca `exec(command, ...)` con texto provisto por usuario.

Recomendación:
- Deshabilitar por defecto en producción.
- Reemplazar por comandos administrativos concretos allowlist (ej. `status`, `logs`, `uptime`) en lugar de shell libre.
- Si se conserva, exigir segundo factor/código temporal y bitácora persistente.

### 3) Riesgo alto: API key hardcodeada en código fuente

- Se detecta una `apiKey` en el estado por defecto del gestor de proveedores.
- Esto dificulta rotación de secretos y expone credenciales si el repo se comparte.

Referencia:
- `lib/api-manager.js` contiene `apiKey` literal.

Recomendación:
- Mover secretos a variables de entorno.
- Cargar `apiKey` desde entorno y dejar valor por defecto vacío.
- Rotar la clave actual tras migrar.

### 4) Riesgo medio: validación de ruta potencialmente frágil en `getfile`

- La validación de path usa `resolved.startsWith(cwd)`.
- Esta comparación por prefijo puede ser frágil en ciertos casos de rutas con prefijos similares.

Referencia:
- `commands/admin/getfile.js` en `resolveSafePath`.

Recomendación:
- Usar `path.relative(cwd, resolved)` y rechazar si empieza con `..` o es absoluto.
- Aplicar `realpath` si se desea endurecer contra symlinks.

## Observaciones de calidad

- ✅ Sintaxis de todos los JS/CJS: correcta.
- ✅ Organización por módulos/comandos: clara para mantenimiento incremental.
- ⚠️ Archivo `index.js` muy grande (acoplamiento elevado); conviene seguir extrayendo bloques a `lib/`.
- ⚠️ No se observan scripts formales de test automatizados en `package.json` (solo `check` sobre `index.js`).

## Plan de mejora sugerido (orden recomendado)

1. **Seguridad inmediata (día 1)**
   - Deshabilitar `.eval` y `.exec` en producción por defecto.
   - Rotar API keys y sacar secretos del repositorio.

2. **Hardening (semana 1)**
   - Endurecer validación de rutas en `.getfile`.
   - Añadir trazabilidad de comandos owner (`command`, `jid`, `timestamp`, resultado).

3. **Calidad (semana 2)**
   - Introducir `npm run check:all` para validar sintaxis de todos los JS/CJS.
   - Añadir tests mínimos de smoke para comandos críticos.

## Comandos ejecutados durante la revisión

- `node --check` para cada archivo `*.js` y `*.cjs` del repositorio.
- `npm run check`.
- Búsquedas estáticas con `rg` para patrones sensibles (`eval`, `exec`, `apiKey`, `secret`, etc.).

