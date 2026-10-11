# DmPlugin Config Manager

Panel local, independiente y sin dependencias npm para leer y coordinar varios bots DarkBot mediante el MCP Bridge de DmPlugin.

## Requisitos

- Node.js 20 o superior (incluye `fetch`; no hace falta instalar paquetes).
- DmPlugin cargado en cada bot, con MCP habilitado y puerto configurado (por defecto `9876`).
- Un endpoint de chat compatible con OpenAI (ruta `/chat/completions`), un identificador de modelo y una API key si el proveedor la requiere.

## Ejecutar en Windows

Desde la raíz del repositorio:

```powershell
node dmplugin-config-manager/manager.js
```

Abre <http://127.0.0.1:8765/>. Para usar otro puerto:

```powershell
node dmplugin-config-manager/manager.js --port 8766
```

El servidor solo escucha en loopback. Pulsa `Ctrl+C` en la terminal para detenerlo; cerrar la pestaña no detiene el proceso.

## Uso

1. En **URL base OpenAI-compatible**, indica la URL base del proveedor (por ejemplo, `https://api.example.com/v1`), el identificador exacto del modelo y la API key si es necesaria. El gestor añade `/chat/completions`; también acepta una URL terminada ya con esa ruta.
2. Añade cada bot mediante su puerto MCP, el nombre exacto del perfil activo y una descripción breve de los perfiles existentes (el MCP comparte los nombres, pero no el propósito).
3. La primera revisión se programa después de conectar y las siguientes usan el intervalo configurado (8 horas por defecto).
4. **Aplicar perfil guardado** permite aplicar solo una recomendación de perfil que siga existiendo en MCP. Desactívalo para recibir recomendaciones sin cambios automáticos.

La configuración local se guarda en `~/.dmplugin-manager/state.json` (Windows: carpeta del usuario). Puedes cambiar la ubicación con `DM_MANAGER_HOME`. El archivo almacena la API key localmente con permisos privados en sistemas POSIX. La key nunca se devuelve al navegador; los datos de juego y perfiles se envían al endpoint elegido. Comprueba la política de privacidad del proveedor.

## Capacidades y límites

El MCP consultado ofrece recursos de estado, estadísticas, inventario, perfiles y eventos, además de `set_profile` y `set_config`. No se observó herramienta para crear perfiles o comprar equipamiento. Por lo tanto, este gestor:

- Cambia solo a perfiles existentes cuando se recomienda y está activada la aplicación automática.
- No crea perfiles nuevos, compra objetos, gasta créditos/uridium ni modifica libremente ajustes.
- Reserva el uridium para puertas y envía al proveedor configurado un resumen limitado del estado del bot seleccionado.

El inventario disponible puede no reflejar todas las propiedades o niveles del equipo; las recomendaciones no garantizan la configuración óptima.

## Pruebas

```powershell
node --test dmplugin-config-manager/tests/*.test.js
node --check dmplugin-config-manager/app.js
```
