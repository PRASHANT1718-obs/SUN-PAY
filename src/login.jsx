import { useEffect, useState } from "react";
import { supabase } from "./lib/supabase";
import App from "./App.jsx";
import "./Login.css";

export default function Login() {
  const [session, setSession] = useState(null);
  const [checking, setChecking] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [heading, setHeading] = useState("");

  // Check the existing Supabase session
  useEffect(() => {
    let active = true;

    async function checkSession() {
      try {
        const { data, error } = await supabase.auth.getSession();

        if (!active) return;

        if (error) {
          setError("Unable to check session. Please refresh.");
        }

        setSession(data?.session ?? null);
      } catch {
        if (active) {
          setError("Unable to check session. Please refresh.");
        }
      } finally {
        if (active) setChecking(false);
      }
    }

    checkSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (active) {
        setSession(newSession);
        setChecking(false);
        setError("");
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  // Animated typewriter heading
  useEffect(() => {
    const text = "Payments, made simple.";
    let i = 0;

    const timer = setInterval(() => {
      i++;
      setHeading(text.slice(0, i));

      if (i >= text.length) {
        clearInterval(timer);
      }
    }, 65);

    return () => clearInterval(timer);
  }, []);

  // Supabase email/password login
  async function handleLogin(event) {
    event.preventDefault();

    if (loading) return;

    setError("");
    setLoading(true);

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (error) throw error;

      if (!data?.session) {
        setError("Login could not be completed. Please try again.");
      }
    } catch (err) {
      setError(
        err?.message === "Invalid login credentials"
          ? "Incorrect email or password."
          : err?.message || "Login failed. Please try again.",
      );
    } finally {
      setLoading(false);
    }
  }

  // Sign out
  async function handleLogout() {
    setError("");

    try {
      const { error } = await supabase.auth.signOut();

      if (error) throw error;
    } catch (err) {
      setError(err?.message || "Unable to log out. Please try again.");
    }
  }

  // Loading screen
  if (checking) {
    return (
      <div className="sp-loading">
        <div className="sp-spinner" />
        <p>Loading SUN PAY...</p>
      </div>
    );
  }

  // Authenticated application
  if (session) {
    return (
      <div className="sp-app">
        <header className="sp-app-header">
          <a className="sp-logo" href="#home">
            <span className="sp-logo-icon">S</span>
            <span>
              SUN <b>PAY</b>
            </span>
          </a>

          <button className="sp-logout" type="button" onClick={handleLogout}>
            Logout
          </button>
        </header>

        {error && (
          <p className="sp-error" role="alert">
            {error}
          </p>
        )}

        <App />
      </div>
    );
  }

  // Login screen
  return (
    <main className="sp-page">
      <header className="sp-header">
        <a className="sp-logo" href="#home">
          <span className="sp-logo-icon">S</span>
          <span>
            SUN <b>PAY</b>
          </span>
        </a>

        <span className="sp-private">
          <span className="sp-dot" />
          PRIVATE ACCESS
        </span>
      </header>

      <section className="sp-content">
        <div className="sp-intro">
          <div className="sp-small-label">
            <span className="sp-label-line" />
            YOUR PERSONAL PAYMENT SPACE
          </div>

          <h1>
            {heading}
            <span className="sp-cursor">|</span>
          </h1>

          <div className="sp-benefits">
            <div className="sp-benefit">
              <span className="sp-check">✓</span>
              Simple payment experience
            </div>

            <div className="sp-benefit">
              <span className="sp-check">✓</span>
              Private account access
            </div>
          </div>

          <div className="sp-decoration" aria-hidden="true">
            <div className="sp-circle sp-circle-one" />
            <div className="sp-circle sp-circle-two" />
            <div className="sp-center-symbol">₹</div>
            <span className="sp-spark sp-spark-one">✦</span>
            <span className="sp-spark sp-spark-two">✧</span>
          </div>
        </div>

        <div className="sp-login-wrap">
          <div className="sp-login-card">
            <div className="sp-card-icon">
              <svg
                width="25"
                height="25"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <rect x="4" y="10" width="16" height="11" rx="2" />
                <path d="M8 10V7a4 4 0 0 1 8 0v3" />
              </svg>
            </div>

            <h2>Welcome back</h2>

            <p className="sp-card-description">
              Sign in to continue to SUN PAY.
            </p>

            <form onSubmit={handleLogin} className="sp-professional-form">
              <div className="sp-horizontal-field">
                <label htmlFor="sp-email">Email address</label>

                <input
                  id="sp-email"
                  type="email"
                  placeholder="Enter your email"
                  autoComplete="username"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                />
              </div>

              <div className="sp-horizontal-field">
                <label htmlFor="sp-password">Password</label>

                <div className="sp-horizontal-password">
                  <input
                    id="sp-password"
                    type={showPassword ? "text" : "password"}
                    placeholder="Enter your password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    required
                  />

                  <button
                    type="button"
                    className="sp-show"
                    onClick={() => setShowPassword((current) => !current)}
                    aria-label={
                      showPassword ? "Hide password" : "Show password"
                    }
                  >
                    {showPassword ? "Hide" : "Show"}
                  </button>
                </div>
              </div>

              {error && (
                <div className="sp-error" role="alert">
                  {error}
                </div>
              )}

              <button className="sp-submit" type="submit" disabled={loading}>
                {loading ? "Signing in..." : "Sign in"}
                {!loading && <span>→</span>}
              </button>
            </form>

            <div className="sp-security">
              <span>♢</span>
              Your account is protected with Supabase Auth.
            </div>
          </div>

          <p className="sp-footer">
            © {new Date().getFullYear()} SUN PAY
            <span>·</span>
            PERSONAL USE
          </p>
        </div>
      </section>
    </main>
  );
}
