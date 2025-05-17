"use client"

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabaseClient";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [isSignUp, setIsSignUp] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const checkSession = async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        router.replace("/");
      }
    };
    checkSession();
    // 실시간 세션 변경 감지
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) {
        router.replace("/");
      }
    });
    return () => {
      listener?.subscription.unsubscribe();
    };
  }, [router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage("");
    if (isSignUp) {
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) {
        setMessage(error.message);
      } else {
        setMessage("회원가입이 완료되었습니다! 이메일 인증 후 로그인하세요.");
      }
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setMessage(error.message);
      } else {
        setMessage("로그인 성공!");
        // 세션 변경 감지로 인해 자동 리다이렉트됨
      }
    }
    setLoading(false);
  };

  return (
    <div style={{ maxWidth: 400, margin: "100px auto", padding: 24, border: "1px solid #eee", borderRadius: 8 }}>
      <h2>{isSignUp ? "회원가입" : "로그인"}</h2>
      <form onSubmit={handleSubmit}>
        <input
          type="email"
          placeholder="이메일을 입력하세요"
          value={email}
          onChange={e => setEmail(e.target.value)}
          required
          style={{ width: "100%", padding: 8, marginBottom: 12 }}
        />
        <input
          type="password"
          placeholder="비밀번호를 입력하세요"
          value={password}
          onChange={e => setPassword(e.target.value)}
          required
          style={{ width: "100%", padding: 8, marginBottom: 12 }}
        />
        <button type="submit" disabled={loading} style={{ width: "100%", padding: 8 }}>
          {loading ? (isSignUp ? "가입 중..." : "로그인 중...") : (isSignUp ? "회원가입" : "로그인")}
        </button>
      </form>
      <button
        onClick={() => { setIsSignUp(!isSignUp); setMessage(""); }}
        style={{ width: "100%", marginTop: 12, background: "none", border: "none", color: "#0070f3", cursor: "pointer" }}
      >
        {isSignUp ? "이미 계정이 있으신가요? 로그인" : "계정이 없으신가요? 회원가입"}
      </button>
      {message && <p style={{ marginTop: 16 }}>{message}</p>}
    </div>
  );
} 