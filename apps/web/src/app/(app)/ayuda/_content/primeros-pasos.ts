import type { HelpCategory } from "./types";

export const primerosPasos: HelpCategory = {
  slug: "primeros-pasos",
  title: "Primeros pasos",
  articles: [
    {
      slug: "que-es-atiende-ya",
      title: "Qué es Atiende ya",
      summary: "El portal operativo de tu tienda: el cliente escribe por WhatsApp, el agente responde y tú cierras la venta.",
      audience: "both",
      body: [
        {
          type: "p",
          text:
            "Atiende ya conecta tu catálogo, tus clientes y WhatsApp en un solo lugar. Un cliente te escribe, " +
            "el agente automático le contesta con tu catálogo real (precio y existencia vigentes), arma una " +
            "cotización, y si el cliente acepta, genera el link de pago. Tú ves todo eso desde el panel: qué " +
            "se cotizó, qué se pagó, y puedes tomar cualquier conversación tú mismo cuando haga falta.",
        },
        {
          type: "list",
          items: [
            "Catálogo: tus productos y variantes, con precio y existencia.",
            "Clientes: fichas con historial de cotizaciones y pedidos.",
            "Cotizaciones y pedidos: desde que se arma el carrito hasta que se cobra.",
            "Conversaciones: la bandeja de WhatsApp, con el agente y con atención humana.",
            "Administración: marca, usuarios, notificaciones, seguridad y API keys.",
          ],
        },
        {
          type: "callout",
          tone: "info",
          title: "Modo de pruebas",
          text:
            "Si ves la etiqueta \"Pruebas\" en la barra superior, los pagos son simulados (dummy gateway) — " +
            "no se mueve dinero real. Sirve para probar el flujo completo antes de salir a producción.",
        },
      ],
      related: ["recorrido-del-panel", "roles-de-usuario"],
    },
    {
      slug: "recorrido-del-panel",
      title: "Recorrido del panel",
      summary: "Qué hace cada sección del menú lateral.",
      audience: "both",
      body: [
        { type: "h3", text: "Operación" },
        {
          type: "list",
          items: [
            "Catálogo — productos, variantes, precios, existencias y fotos.",
            "Cotizaciones — cotizaciones en borrador, emitidas, aceptadas o vencidas.",
            "Cobro rápido — cobra un monto libre sin pasar por catálogo ni cotización.",
            "Pedidos — pedidos creados desde una cotización o directos, su checkout y su estado.",
            "Pagos — sesiones de cobro, el libro de movimientos y reembolsos.",
            "Clientes — fichas de contacto, direcciones y consentimientos.",
          ],
        },
        { type: "h3", text: "Agente IA" },
        {
          type: "list",
          items: [
            "Chat con el agente — prueba el bot tú mismo, como si fueras el cliente.",
            "Consola del agente — qué sabe el agente de tu negocio y cómo se comporta.",
            "Canales — conexiones de WhatsApp (Meta o Evolution).",
            "Conversaciones — la bandeja real de WhatsApp: hilos, quién los atiende, notas.",
          ],
        },
        { type: "h3", text: "Sistema" },
        {
          type: "list",
          items: [
            "Admin — empresa, marca, envío a domicilio, usuarios, API keys, notificaciones y seguridad.",
            "Ayuda — esta guía.",
          ],
        },
        {
          type: "callout",
          tone: "info",
          text: "Si eres super-admin de la plataforma, además ves \"Plataforma\" arriba de todo: Empresas, Uso y costos, y API keys globales.",
        },
      ],
      related: ["que-es-atiende-ya"],
    },
    {
      slug: "roles-de-usuario",
      title: "Roles y qué puede hacer cada uno",
      summary: "OWNER, ADMIN, VENDOR, FINANCE, CATALOG, SUPPORT, VIEWER — la diferencia entre ellos.",
      audience: "owner",
      body: [
        {
          type: "p",
          text: "Cada persona que invitas a tu empresa tiene un rol. El rol decide qué secciones ve y qué puede hacer, no solo ver.",
        },
        {
          type: "table",
          headers: ["Rol", "Para quién es", "Puede"],
          rows: [
            ["OWNER", "Dueño del negocio", "Todo: incluida administración de la empresa, usuarios y API keys."],
            ["ADMIN", "Mano derecha del dueño", "Casi todo, salvo lo reservado a OWNER (dar de baja la empresa, ceder otro OWNER)."],
            ["VENDOR", "Vendedor / atención al cliente", "Catálogo (lectura), clientes, cotizaciones, pedidos propios, chat."],
            ["FINANCE", "Cuentas por cobrar", "Ver catálogo/clientes/cotizaciones/pedidos, pagos y reembolsos."],
            ["CATALOG", "Encargado de catálogo", "Solo catálogo, lectura y escritura."],
            ["SUPPORT", "Atención al cliente sin ventas", "Ver catálogo/clientes/cotizaciones/pedidos, y chat."],
            ["VIEWER", "Solo consulta", "Ver catálogo, clientes, cotizaciones, pedidos y notificaciones — nada de escritura."],
          ],
        },
        {
          type: "p",
          text: "Se invita desde Admin → Usuarios. La persona recibe un correo con un link de invitación; al aceptarlo crea su contraseña.",
        },
      ],
      related: ["invitar-usuarios"],
    },
  ],
};
