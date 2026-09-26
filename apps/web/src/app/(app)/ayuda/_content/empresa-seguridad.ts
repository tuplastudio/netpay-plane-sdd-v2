import type { HelpCategory } from "./types";

export const empresaSeguridad: HelpCategory = {
  slug: "empresa-seguridad",
  title: "Empresa y seguridad",
  articles: [
    {
      slug: "marca",
      title: "Marca: logo y colores",
      summary: "Lo que ve tu cliente en el link público de cotización y en el checkout.",
      audience: "owner",
      body: [
        {
          type: "p",
          text:
            "Admin → Marca: sube tu logo y define color primario, secundario y de acento. Se usan en el link " +
            "público de cotización, el checkout y el seguimiento de pedido — todo lo que ve el cliente sin " +
            "iniciar sesión.",
        },
      ],
    },
    {
      slug: "invitar-usuarios",
      title: "Invitar usuarios a tu empresa",
      summary: "Correo, nombre y rol — la persona acepta el link y crea su propia contraseña.",
      audience: "owner",
      keywords: ["agregar usuario", "nuevo usuario", "invitación"],
      body: [
        {
          type: "steps",
          items: [
            "Admin → Usuarios → Invitar.",
            "Correo, nombre completo y rol.",
            "Se manda un correo con un link de invitación.",
            "La persona lo abre, crea su contraseña, y ya puede entrar.",
          ],
        },
        {
          type: "callout",
          tone: "info",
          text: "Solo OWNER puede invitar a otro OWNER — cualquier otro rol lo puede invitar un ADMIN sin problema.",
        },
      ],
      related: ["roles-de-usuario"],
    },
    {
      slug: "seguridad-de-la-cuenta",
      title: "Contraseña y verificación en dos pasos (MFA)",
      summary: "Activa MFA con una app como Google Authenticator; guarda tus códigos de recuperación.",
      audience: "owner",
      keywords: ["2fa", "doble factor", "cambiar contraseña", "totp"],
      body: [
        {
          type: "p",
          text:
            "Admin → Seguridad te deja cambiar tu contraseña y activar MFA (TOTP). Al activarlo, el sistema te " +
            "da también códigos de recuperación de un solo uso — descárgalos y guárdalos en un lugar seguro: " +
            "sin ellos, perder tu teléfono te deja sin forma de entrar.",
        },
      ],
    },
  ],
};
