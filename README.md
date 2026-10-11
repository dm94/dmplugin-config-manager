# DmPlugin Config Manager

Panel local para leer y coordinar varios bots DarkBot mediante el MCP Bridge de DmPlugin.

## Requisitos

- Python 3.10+ (sin dependencias Python adicionales).
- DmPlugin cargado en cada bot, con MCP habilitado y puerto configurado (por defecto `9876`).
- Un endpoint de chat compatible con OpenAI (ruta `/chat/completions`), un identificador de modelo y una API key si el proveedor la requiere.

La URL y el modelo se configuran en el panel; la API key se guarda en el archivo local del gestor y no se devuelve al navegador. En proveedores remotos se exige HTTPS. Los datos del juego y perfiles seleccionados se envían al proveedor que configures; revisa su política de privacidad. Los puertos MCP admiten localhost o IPs privadas de la LAN.

## Ejecutar en Windows

Desde la carpeta raíz del repositorio:

```powershell
python dmplugin-config-manager/manager.py
```

Después abre <http://127.0.0.1:8765/>. Para otro puerto:

```powershell
python dmplugin-config-manager/manager.py --port 8766
```

La app solo enlaza a loopback. Usa `Ctrl+C` en la terminal para cerrarla. Al cerrar el panel, el proceso continúa activo hasta que se detenga.

## Uso

1. En **URL base OpenAI-compatible**, indica la URL base del proveedor (por ejemplo, `https://api.example.com/v1`), el identificador exacto del modelo y la API key si es necesaria. El gestor añade `/chat/completions`; también puedes pegar una URL que ya termine con esa ruta.
2. Añade cada bot e indica el puerto MCP, el nombre exacto del perfil actual y una breve descripción del uso de los perfiles existentes (el MCP da sus nombres, pero no exporta su propósito).
3. La primera revisión comienza después de conectar. Las siguientes se programan al intervalo configurado (8 horas inicialmente).
4. La casilla **Aplicar perfil guardado** permite aplicar directamente solo una recomendación cuyo perfil se haya revalidado contra la lista actual de MCP. Desactívala para recibir recomendaciones sin aplicarlas.
5. Puedes lanzar una revisión manual desde cada tarjeta.

Los datos de conexión se guardan en `~/.dmplugin-manager/state.json` (en Windows, dentro del directorio del usuario). Se puede cambiar esa ubicación con `DM_MANAGER_HOME`. Para eliminar la configuración, detén la app y borra ese archivo y su carpeta.

## Capacidades verificadas y límites

En la instancia MCP inspeccionada se observaron `bot://profiles`, estado, estadísticas, inventario y eventos, además de `set_profile` y `set_config`. **No** se observó una herramienta para crear/guardar perfiles, ni operaciones de compra de equipamiento. Por ello esta versión:

- Puede cambiar a un perfil ya existente si la revisión local lo recomienda y la aplicación automática está activada.
- No crea perfiles nuevos, compra objetos, gasta créditos/uridium ni modifica libremente opciones de configuración.
- Trata el uridium como recurso reservado para puertas; no ejecuta ninguna acción de gasto.
- Envía al endpoint configurado un resumen acotado del estado, estadísticas, perfiles, evento e indicios de equipamiento del bot seleccionado.

La revisión analiza los datos que ofrece el MCP. El inventario no necesariamente representa todas las propiedades o niveles del equipo, así que una recomendación de IA no es una garantía de obtener la mejor configuración posible.
