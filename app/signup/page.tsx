"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setLoading(true);

    // Validate invite code via API
    const codeRes = await fetch("/api/validate-invite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: inviteCode.trim().toUpperCase() }),
    });
    const codeData = await codeRes.json();
    if (!codeData.valid) {
      setError(codeData.reason === "This invite code has expired"
        ? "That invite code has expired. Ask Jeff for a new one."
        : "Invalid invite code. Contact Jeff to get access.");
      setLoading(false);
      return;
    }

    const supabase = createClient();
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    if (error) {
      setError(error.message);
      setLoading(false);
    } else {
      setDone(true);
    }
  }

  if (done) {
    return (
      <div className="min-h-full flex items-center justify-center px-4">
        <div className="w-full max-w-sm text-center">
          <p className="text-4xl mb-4">📬</p>
          <h2 className="text-xl font-bold text-green-400 mb-2">Check your email</h2>
          <p className="text-gray-400 text-sm">
            We sent a confirmation link to <span className="text-white">{email}</span>.
            Click it to activate your account and meet your caddy.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-green-400">⛳ ForeThought</h1>
          <p className="text-gray-400 mt-2">Create your account</p>
        </div>

        <form onSubmit={handleSignup} className="space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Invite Code</label>
            <input
              type="text"
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
              required
              className="w-full rounded-xl bg-gray-800 border border-gray-700 px-4 py-3 text-white text-lg focus:outline-none focus:border-green-500 uppercase tracking-widest"
              placeholder="XXXXXXXX"
              autoCapitalize="characters"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full rounded-xl bg-gray-800 border border-gray-700 px-4 py-3 text-white text-lg focus:outline-none focus:border-green-500"
              placeholder="you@example.com"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full rounded-xl bg-gray-800 border border-gray-700 px-4 py-3 text-white text-lg focus:outline-none focus:border-green-500"
              placeholder="at least 8 characters"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Confirm Password</label>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              className="w-full rounded-xl bg-gray-800 border border-gray-700 px-4 py-3 text-white text-lg focus:outline-none focus:border-green-500"
              placeholder="••••••••"
            />
          </div>

          {error && <p className="text-red-400 text-sm">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-green-600 hover:bg-green-500 disabled:opacity-50 px-4 py-3 text-white font-semibold text-lg transition-colors"
          >
            {loading ? "Creating account…" : "Create Account"}
          </button>

          <p className="text-center text-sm text-gray-500">
            Already have an account?{" "}
            <Link href="/login" className="text-green-400 hover:underline">
              Sign in
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}
