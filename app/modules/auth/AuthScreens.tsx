import type { Dispatch, SetStateAction } from "react";
import styles from "./AuthScreens.module.css";

export function SecureLoading() {
  return <main className={styles.screen}><p className={styles.loading}>Verificando acceso seguro…</p></main>;
}

type AccessScreenProps = {
  portal: "admin" | "ventas";
  login: string;
  setLogin: Dispatch<SetStateAction<string>>;
  password: string;
  setPassword: Dispatch<SetStateAction<string>>;
  showPassword: boolean;
  setShowPassword: Dispatch<SetStateAction<boolean>>;
  authLoading: boolean;
  recoverySending: boolean;
  recoveryStage: "idle" | "code";
  recoveryCode: string;
  setRecoveryCode: Dispatch<SetStateAction<string>>;
  recoveryPassword: string;
  setRecoveryPassword: Dispatch<SetStateAction<string>>;
  recoveryPasswordConfirm: string;
  setRecoveryPasswordConfirm: Dispatch<SetStateAction<string>>;
  setRecoveryStage: Dispatch<SetStateAction<"idle" | "code">>;
  message: string;
  setMessage: Dispatch<SetStateAction<string>>;
  enter: () => void;
  requestPasswordReset: () => void;
  confirmEmailRecovery: () => void;
};

export function AccessScreen(props: AccessScreenProps) {
  const { portal, login, setLogin, password, setPassword, showPassword, setShowPassword,
    authLoading, recoverySending, recoveryStage, recoveryCode, setRecoveryCode,
    recoveryPassword, setRecoveryPassword, recoveryPasswordConfirm, setRecoveryPasswordConfirm,
    setRecoveryStage, message, setMessage, enter, requestPasswordReset, confirmEmailRecovery } = props;
  return (
    <main className={styles.screen}>
      <section className={styles.card}>
        <p className={styles.brand}>L&apos;ARTISAN</p>
        <p className={styles.eyebrow}>{portal === "admin" ? "ADMINISTRACIÓN CENTRAL" : "VENTAS Y OPERACIÓN DE LOCALES"}</p>
        <h1 className={styles.title}>{portal === "admin" ? "Acceso administrativo" : "Ingresar"}</h1>
        <label className={`${styles.label} ${styles.firstLabel}`}>{portal === "admin" ? "Usuario o correo laboral" : "Usuario"}</label>
        <input value={login} onChange={(event) => setLogin(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); void enter(); } }} type="text" autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder={portal === "admin" ? "usuario administrativo" : "nombre.apellido"} className={styles.input} />
        <label className={styles.label}>Contraseña</label>
        <div className={styles.passwordWrap}>
          <input value={password} onChange={(event) => setPassword(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); void enter(); } }} type={showPassword ? "text" : "password"} placeholder="Tu contraseña" className={styles.passwordInput} />
          <button type="button" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"} aria-pressed={showPassword} className={styles.toggle}>{showPassword ? "Ocultar" : "Mostrar"}</button>
        </div>
        <button onClick={requestPasswordReset} disabled={recoverySending} className={styles.resetButton}>{recoverySending && recoveryStage === "idle" ? "Enviando…" : portal === "admin" ? "Enviar código de recuperación" : "Olvidé mi contraseña"}</button>
        {portal === "admin" && recoveryStage === "code" && (
          <div className={styles.recoveryBox}>
            <p className="text-sm font-bold">Recuperar acceso</p>
            <p className={styles.hint}>Si la cuenta está habilitada, el código llegará al canal de recuperación configurado y vencerá en 15 minutos.</p>
            <label className={styles.label}>Código de 6 dígitos</label>
            <input value={recoveryCode} onChange={(event) => setRecoveryCode(event.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" placeholder="000000" className={styles.codeInput} />
            <label className={styles.label}>Nueva contraseña</label>
            <input value={recoveryPassword} onChange={(event) => setRecoveryPassword(event.target.value)} type="password" autoComplete="new-password" placeholder="Mínimo 8 caracteres" className={styles.input} />
            <label className={styles.label}>Repetir contraseña</label>
            <input value={recoveryPasswordConfirm} onChange={(event) => setRecoveryPasswordConfirm(event.target.value)} onKeyDown={(event) => event.key === "Enter" && confirmEmailRecovery()} type="password" autoComplete="new-password" className={styles.input} />
            <button onClick={confirmEmailRecovery} disabled={recoverySending} className={styles.danger}>{recoverySending ? "Validando…" : "Cambiar contraseña"}</button>
            <button onClick={() => { setRecoveryStage("idle"); setMessage(""); }} className={styles.linkButton}>Cancelar</button>
          </div>
        )}
        <button onClick={enter} disabled={authLoading} className={styles.primary}>{authLoading ? "Verificando…" : "Ingresar"}</button>
        {message && <p className={styles.message}>{message}</p>}
      </section>
    </main>
  );
}

type ForcePasswordChangeProps = {
  currentPassword: string;
  setCurrentPassword: Dispatch<SetStateAction<string>>;
  newPassword: string;
  setNewPassword: Dispatch<SetStateAction<string>>;
  confirmNewPassword: string;
  setConfirmNewPassword: Dispatch<SetStateAction<string>>;
  message: string;
  changeOwnPassword: () => void;
  logout: () => void;
};

export function ForcePasswordChangeScreen({ currentPassword, setCurrentPassword, newPassword, setNewPassword, confirmNewPassword, setConfirmNewPassword, message, changeOwnPassword, logout }: ForcePasswordChangeProps) {
  return (
    <main className={styles.screen}>
      <section className={styles.card}>
        <p className={styles.brand}>L&apos;ARTISAN</p>
        <p className={styles.eyebrow}>SEGURIDAD</p>
        <h1 className={styles.title}>Creá tu contraseña personal</h1>
        <p className={styles.description}>La clave provisoria debe reemplazarse antes de utilizar el sistema.</p>
        <label className={`${styles.label} ${styles.firstLabel}`}>Contraseña provisoria<input value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} type="password" className={styles.input} /></label>
        <label className={styles.label}>Nueva contraseña<input value={newPassword} onChange={(event) => setNewPassword(event.target.value)} type="password" className={styles.input} /></label>
        <label className={styles.label}>Repetir nueva contraseña<input value={confirmNewPassword} onChange={(event) => setConfirmNewPassword(event.target.value)} type="password" className={styles.input} /></label>
        <p className={styles.hint}>Usá al menos 8 caracteres, mayúscula, minúscula, número y símbolo.</p>
        <button onClick={changeOwnPassword} className={styles.primary}>Guardar nueva contraseña</button>
        <button onClick={logout} className={styles.linkButton}>Volver al ingreso</button>
        {message && <p className={styles.message}>{message}</p>}
      </section>
    </main>
  );
}
