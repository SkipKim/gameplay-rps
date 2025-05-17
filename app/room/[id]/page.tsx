"use client"

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "../../../lib/supabaseClient";

interface Room {
  id: string;
  host_id: string;
  created_at: string;
  status: string;
  player_count: number;
}

interface Player {
  id: string;
  user_id: string;
  user_email: string;
  choice: string | null;
  result: string | null;
  restart_ready: boolean | null;
}

const CHOICES = [
  { key: "scissors", label: "가위" },
  { key: "rock", label: "바위" },
  { key: "paper", label: "보" },
];

export default function RoomPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [room, setRoom] = useState<Room | null>(null);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [myPlayerId, setMyPlayerId] = useState<string | null>(null);
  const [choiceLoading, setChoiceLoading] = useState(false);
  const [playerCount, setPlayerCount] = useState(0);

  // 방 정보 및 유저 정보 불러오기
  useEffect(() => {
    console.log('[RoomPage] useEffect - 방 정보 및 유저 정보 불러오기 시작');
    const fetchRoom = async () => {
      const { data } = await supabase.auth.getSession();
      console.log('[RoomPage] getSession 결과:', data);
      if (!data.session || !data.session.user) {
        console.log('[RoomPage] 세션 없음, 로그인 페이지로 이동');
        router.replace("/login");
        return;
      }
      setUserId(data.session.user.id);
      setUserEmail(data.session.user.email ?? null);
      const { data: roomData, error } = await supabase
        .from("rooms")
        .select("*")
        .eq("id", id)
        .single();
      console.log('[RoomPage] rooms select 결과:', roomData, error);
      if (!error && roomData) {
        setRoom(roomData as Room);
      }
      setLoading(false);
    };
    fetchRoom();
  }, [id, router]);

  // 참가자 목록 fetch 함수 분리 (count 포함)
  const fetchPlayers = async () => {
    if (!room?.id) return;
    const { data, count, error } = await supabase
      .from("players")
      .select("id, user_id, user_email", { count: "exact" })
      .eq("room_id", room.id);
    if (!error && data) {
      setPlayers(data as Player[]);
      setPlayerCount(count ?? 0);
    }
  };

  // players 테이블에 참가자 자동 등록 & 내 player id 저장
  useEffect(() => {
    if (!userId || !userEmail || !room) return;
    let cancelled = false;
    const joinPlayer = async () => {
      const { data: exist } = await supabase
        .from("players")
        .select("*")
        .eq("room_id", room.id)
        .eq("user_id", userId)
        .maybeSingle();
      if (exist) {
        setMyPlayerId(exist.id);
        return;
      }
      const insertPayload = { room_id: room.id, user_id: userId, user_email: userEmail };
      const { data: newPlayer, error } = await supabase
        .from("players")
        .insert(insertPayload)
        .select()
        .single();
      if (!error && newPlayer) {
        setMyPlayerId(newPlayer.id);
        // 500ms 후 fetchPlayers 한 번 더 호출
        setTimeout(() => { fetchPlayers(); }, 500);
      } else if (error) {
        if (error.message.includes('duplicate key value')) {
          const { data: exist2 } = await supabase
            .from("players")
            .select("*")
            .eq("room_id", room.id)
            .eq("user_id", userId)
            .maybeSingle();
          if (exist2) setMyPlayerId(exist2.id);
        }
      }
    };
    joinPlayer();
    return () => { cancelled = true; };
  }, [userId, userEmail, room]);

  // 참가자 목록 및 실시간 동기화
  useEffect(() => {
    if (!room?.id) return;
    fetchPlayers();
    const channel = supabase.channel('players-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'players', filter: `room_id=eq.${room.id}` }, fetchPlayers)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [room?.id]);

  // 방 나가기(참가자 row 삭제)
  const handleLeaveRoom = async () => {
    if (myPlayerId) {
      await supabase.from("players").delete().eq("id", myPlayerId);
      // 500ms 후 fetchPlayers 한 번 더 호출
      setTimeout(() => { fetchPlayers(); }, 500);
    }
    router.push("/");
  };

  if (loading) return <div>로딩 중...</div>;
  if (!room) return <div>방 정보를 불러올 수 없습니다.</div>;

  return (
    <div style={{ maxWidth: 400, margin: "40px auto", padding: 24, border: "1px solid #eee", borderRadius: 8 }}>
      <h2>게임방</h2>
      <div style={{ marginBottom: 16 }}>
        <b>방 ID:</b> {room.id.slice(0, 8)}...<br />
        <b>상태:</b> {room.status}<br />
        <b>인원:</b> {playerCount}
      </div>
      <h3>참여자 목록</h3>
      <ul style={{ marginBottom: 24 }}>
        {players.map((p) => (
          <li key={p.id} style={{ color: p.user_id === userId ? '#0070f3' : undefined }}>
            {p.user_email}
          </li>
        ))}
      </ul>
      <button onClick={handleLeaveRoom} style={{ marginTop: 32, width: '100%', padding: 8, background: '#eee', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
        로비로 돌아가기
      </button>
    </div>
  );
} 