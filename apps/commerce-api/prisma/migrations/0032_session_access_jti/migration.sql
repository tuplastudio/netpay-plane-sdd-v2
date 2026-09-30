-- Access token JWT ID (jti) por sesión.
--
-- Antes: `Session.tokenHash` era el único token (servía de access y refresh a
-- la vez, cookie HttpOnly, 12h absoluto + 30 min de inactividad).
--
-- Ahora: el access token es un JWT firmado (HS256, 15 min por defecto) que
-- viaja en `Authorization: Bearer` y se valida sin tocar la BD; este JTI va
-- en la fila `Session` para poder revocar el access antes de su `exp` (cambio
-- de rol, logout inmediato, detección de robo) sin esperar a que el JWT
-- venza por sí solo. El campo es opcional y NULL hasta el primer login.
--
-- `tokenHash` pasa a ser el SHA256 del **refresh token** (opaco, cookie
-- HttpOnly separada, 30 días, rotable). La columna no cambia de nombre para
-- no romper filas existentes.

ALTER TABLE "Session" ADD COLUMN IF NOT EXISTS "accessJti" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "Session_accessJti_key"
  ON "Session" ("accessJti")
  WHERE "accessJti" IS NOT NULL;