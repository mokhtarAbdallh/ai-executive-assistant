import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Languages } from "lucide-react";
import { Button, Card, CardBody, Field, InlineAlert, Input } from "./ui";
import { Wordmark } from "./Wordmark";
import { useAuth } from "../auth/AuthContext";
import { ApiError } from "../lib/http";
import { setLanguage } from "../i18n";

type Mode = "login" | "register";

function errorKey(err: unknown, mode: Mode): string {
  if (err instanceof ApiError) {
    if (err.status === 0) return "auth.offline";
    if (mode === "login" && err.status === 401) return "auth.invalidCredentials";
    if (mode === "register" && /already exists/i.test(err.message)) return "auth.emailTaken";
    if (err.status === 400) return "auth.invalidInput";
  }
  return "errors.generic";
}

export function AuthScreen() {
  const { t, i18n } = useTranslation();
  const { login, register } = useAuth();
  const [mode, setMode] = useState<Mode>("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isLogin = mode === "login";
  const language = i18n.language.startsWith("en") ? "en" : "ar";

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (isLogin) await login(email.trim(), password);
      else await register(name.trim(), email.trim(), password);
    } catch (err) {
      setError(t(errorKey(err, mode)));
    } finally {
      setSubmitting(false);
    }
  };

  const switchMode = () => {
    setMode(isLogin ? "register" : "login");
    setError(null);
  };

  return (
    <main className="flex min-h-dvh items-center justify-center bg-app px-4 py-10">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex items-center justify-between">
          <Wordmark />
          <Button
            variant="ghost"
            size="sm"
            icon={<Languages className="h-4 w-4" />}
            onClick={() => setLanguage(language === "ar" ? "en" : "ar")}
          >
            {language === "ar" ? "English" : "العربية"}
          </Button>
        </div>

        <p className="text-sm leading-relaxed text-fg-muted">{t("auth.tagline")}</p>

        <Card>
          <CardBody className="space-y-5">
            <div className="space-y-1">
              <h1 className="text-lg font-semibold text-fg">
                {t(isLogin ? "auth.loginTitle" : "auth.registerTitle")}
              </h1>
              <p className="text-sm text-fg-muted">
                {t(isLogin ? "auth.loginSubtitle" : "auth.registerSubtitle")}
              </p>
            </div>

            {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}

            <form className="space-y-4" onSubmit={(e) => void onSubmit(e)} noValidate={false}>
              {!isLogin ? (
                <Field label={t("auth.name")} htmlFor="auth-name" required>
                  <Input
                    id="auth-name"
                    autoComplete="name"
                    dir="auto"
                    required
                    maxLength={120}
                    placeholder={t("auth.namePlaceholder")}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </Field>
              ) : null}

              <Field label={t("auth.email")} htmlFor="auth-email" required>
                <Input
                  id="auth-email"
                  type="email"
                  dir="ltr"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </Field>

              <Field
                label={t("auth.password")}
                htmlFor="auth-password"
                hint={!isLogin ? t("auth.passwordHint") : undefined}
                required
              >
                <Input
                  id="auth-password"
                  type="password"
                  dir="ltr"
                  autoComplete={isLogin ? "current-password" : "new-password"}
                  required
                  minLength={isLogin ? 1 : 8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </Field>

              <Button type="submit" variant="primary" className="w-full" loading={submitting}>
                {t(isLogin ? "auth.loginBtn" : "auth.registerBtn")}
              </Button>
            </form>

            <button
              type="button"
              onClick={switchMode}
              className="w-full text-center text-sm text-brand hover:underline"
            >
              {t(isLogin ? "auth.toRegister" : "auth.toLogin")}
            </button>
          </CardBody>
        </Card>
      </div>
    </main>
  );
}
