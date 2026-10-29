"use client";

import { AlertCircle, Eye, EyeOff, Hand, Loader2, Lock, ShieldCheck, Video } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { Logo } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useMe } from "@/hooks/use-me";
import { ApiError, login, signup } from "@/lib/auth";

type Field = "name" | "email" | "password";
type Errors = Partial<Record<Field, string>>;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validate(isSignup: boolean, v: { name: string; email: string; password: string }): Errors {
  const e: Errors = {};
  if (isSignup && !v.name.trim()) e.name = "Please enter your name — it's shown to the people you call.";
  if (!v.email.trim()) e.email = "Please enter your email address.";
  else if (!EMAIL.test(v.email.trim())) e.email = "That doesn't look like an email address (example: asha@mail.com).";
  if (!v.password) e.password = "Please enter your password.";
  else if (isSignup && v.password.length < 8) e.password = "Use at least 8 characters.";
  return e;
}

export function AuthForm({ mode }: { mode: "signup" | "login" }) {
  const router = useRouter();
  const { user } = useMe();
  const isSignup = mode === "signup";
  const [values, setValues] = useState({ name: "", email: "", password: "" });
  const [touched, setTouched] = useState<Partial<Record<Field, boolean>>>({});
  const [serverErrors, setServerErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  // Only used in event handlers (never during render).
  const focusField = (f: Field) => ({ name: nameRef, email: emailRef, password: passwordRef })[f].current?.focus();

  // Already signed in: nothing to do here.
  useEffect(() => {
    if (user) router.replace("/");
  }, [user, router]);

  const clientErrors = validate(isSignup, values);
  const errors: Errors = {};
  for (const f of ["name", "email", "password"] as Field[]) {
    const msg = serverErrors[f] ?? (touched[f] ? clientErrors[f] : undefined);
    if (msg) errors[f] = msg;
  }

  function set(field: Field, value: string) {
    setValues((v) => ({ ...v, [field]: value }));
    setServerErrors((e) => ({ ...e, [field]: undefined }));
    setFormError(null);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setTouched({ name: true, email: true, password: true });
    const first = (["name", "email", "password"] as Field[]).find((f) => clientErrors[f]);
    if (first) {
      focusField(first);
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      const u = isSignup ? await signup(values.name.trim(), values.email.trim(), values.password) : await login(values.email.trim(), values.password);
      // New users (or anyone who skipped it) choose how they communicate first.
      router.push(u.preferences ? "/" : "/onboarding");
    } catch (err) {
      setBusy(false);
      if (err instanceof ApiError && err.status === 409) {
        setServerErrors({ email: "An account with this email already exists." });
        focusField("email");
      } else if (err instanceof ApiError && err.status === 401) {
        setFormError("Wrong email or password. Check both and try again.");
      } else if (err instanceof ApiError && err.status === 422 && /email/i.test(err.message)) {
        // The server's validator is stricter than ours (e.g. reserved domains); keep its detail out of the UI.
        setServerErrors({ email: "This email address can't be used. Please use your real email." });
        focusField("email");
      } else if (err instanceof ApiError && err.status === 422) {
        setFormError("Some details weren't accepted. Check the fields and try again.");
      } else if (err instanceof ApiError && err.status === 429) {
        setFormError("Too many attempts. Please wait a few minutes and try again.");
      } else if (err instanceof ApiError) {
        setFormError(err.message);
      } else {
        setFormError("Can't reach the server. Check your internet connection and try again.");
      }
    }
  }

  const describe = (f: Field, hint?: boolean) => [errors[f] ? `${f}-error` : null, hint ? `${f}-hint` : null].filter(Boolean).join(" ") || undefined;

  return (
    <main id="main" className="grid flex-1 lg:grid-cols-[1fr_1.1fr]">
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-ink p-10 text-ink-foreground lg:flex">
        <div aria-hidden className="absolute -top-32 -left-24 size-96 rounded-full bg-brand/45 blur-3xl" />
        <div aria-hidden className="absolute -right-24 -bottom-32 size-96 rounded-full bg-coral/30 blur-3xl" />
        <div className="relative">
          <Logo inverted />
        </div>
        <div className="relative space-y-6">
          <p className="font-heading text-4xl leading-tight font-bold">Sign, speak, type or tap a picture — everyone in the call understands.</p>
          <ul className="space-y-3 text-ink-foreground/85">
            <li className="flex items-center gap-3">
              <Hand className="size-5 text-coral" aria-hidden /> Indian Sign Language recognition on your device
            </li>
            <li className="flex items-center gap-3">
              <Video className="size-5 text-coral" aria-hidden /> Guests join with just a link
            </li>
            <li className="flex items-center gap-3">
              <ShieldCheck className="size-5 text-coral" aria-hidden /> Your video is never uploaded or stored
            </li>
          </ul>
        </div>
        <p className="relative text-sm text-ink-muted">Student research prototype · ISL only</p>
      </aside>

      <div className="flex flex-col px-4 py-6 sm:px-8">
        <div className="lg:hidden">
          <Logo />
        </div>
        <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center py-10">
          <div className="space-y-2">
            <h1 className="text-3xl font-bold">{isSignup ? "Create your account" : "Welcome back"}</h1>
            <p className="text-muted-foreground">
              {isSignup ? "Free. You need an account to start calls — guests can join without one." : "Sign in to start and manage your calls."}
            </p>
          </div>

          <form onSubmit={submit} noValidate className="mt-8 space-y-5">
            {formError && (
              <p role="alert" className="flex items-start gap-2 rounded-xl bg-destructive/10 p-3 text-sm text-destructive">
                <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden /> {formError}
              </p>
            )}
            {isSignup && (
              <div className="space-y-1.5">
                <Label htmlFor="name">Your name</Label>
                <Input
                  id="name"
                  ref={nameRef}
                  className="h-12 text-base"
                  autoComplete="name"
                  value={values.name}
                  onChange={(e) => set("name", e.target.value)}
                  onBlur={() => setTouched((t) => ({ ...t, name: true }))}
                  maxLength={80}
                  aria-invalid={!!errors.name}
                  aria-describedby={describe("name")}
                />
                {errors.name && <FieldError id="name-error">{errors.name}</FieldError>}
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                ref={emailRef}
                className="h-12 text-base"
                type="email"
                inputMode="email"
                autoComplete="email"
                value={values.email}
                onChange={(e) => set("email", e.target.value)}
                onBlur={() => setTouched((t) => ({ ...t, email: true }))}
                aria-invalid={!!errors.email}
                aria-describedby={describe("email")}
              />
              {errors.email && (
                <FieldError id="email-error">
                  {errors.email}
                  {serverErrors.email && (
                    <>
                      {" "}
                      <Link href="/login" className="font-medium underline">
                        Sign in instead
                      </Link>
                    </>
                  )}
                </FieldError>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Input
                  id="password"
                  ref={passwordRef}
                  className="h-12 pr-12 text-base"
                  type={showPassword ? "text" : "password"}
                  autoComplete={isSignup ? "new-password" : "current-password"}
                  value={values.password}
                  onChange={(e) => set("password", e.target.value)}
                  onBlur={() => setTouched((t) => ({ ...t, password: true }))}
                  aria-invalid={!!errors.password}
                  aria-describedby={describe("password", isSignup)}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute top-1/2 right-1.5 flex size-9 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  aria-pressed={showPassword}
                >
                  {showPassword ? <EyeOff className="size-4.5" /> : <Eye className="size-4.5" />}
                </button>
              </div>
              {errors.password ? (
                <FieldError id="password-error">{errors.password}</FieldError>
              ) : (
                isSignup && (
                  <p id="password-hint" className={`text-sm ${values.password.length >= 8 ? "text-success" : "text-muted-foreground"}`}>
                    {values.password.length >= 8 ? "✓ Long enough" : `At least 8 characters (${values.password.length}/8)`}
                  </p>
                )
              )}
            </div>
            <Button type="submit" size="xl" className="w-full" disabled={busy}>
              {busy ? (
                <>
                  <Loader2 className="animate-spin" aria-hidden /> {isSignup ? "Creating your account…" : "Signing in…"}
                </>
              ) : isSignup ? (
                "Create account"
              ) : (
                "Sign in"
              )}
            </Button>
            <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
              <Lock className="size-3.5" aria-hidden /> Passwords are stored hashed (argon2), never in plain text.
            </p>
          </form>

          <p className="mt-8 text-center text-muted-foreground">
            {isSignup ? "Already have an account? " : "New to SignSense? "}
            <Link href={isSignup ? "/login" : "/signup"} className="font-medium text-brand underline-offset-4 hover:underline">
              {isSignup ? "Sign in" : "Create an account"}
            </Link>
          </p>
          <p className="mt-2 text-center text-sm text-muted-foreground">
            Got a meeting link? Just open it — <Link href="/#join" className="underline underline-offset-4 hover:text-foreground">guests don&apos;t need an account</Link>.
          </p>
        </div>
      </div>
    </main>
  );
}

function FieldError({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <p id={id} className="flex items-start gap-1.5 text-sm text-destructive">
      <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  );
}
