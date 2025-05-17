"use client"

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../lib/supabaseClient";

interface Room {
  id: string;
  host_id: string;
  created_at: string;
  status: string;
  player_count: number;
}

export default function MainPage() {
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [roomLoading, setRoomLoading] = useState(false);
  const [playerCounts, setPlayerCounts] = useState<{ [roomId: string]: number }>({});
  const router = useRouter();

  // 유저 정보 및 세션 체크
  useEffect(() => {
    const getUser = async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session && data.session.user) {
        setUserEmail(data.session.user.email ?? null);
        setUserId(data.session.user.id);
      } else {
        router.replace("/login");
      }
      setLoading(false);
    };
    getUser();
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        router.replace("/login");
      }
    });
    return () => {
      listener?.subscription.unsubscribe();
    };
  }, [router]);

  // 방 목록 불러오기 및 실시간 구독
  useEffect(() => {
    if (!userId) return;
    const fetchRooms = async () => {
      const { data, error } = await supabase
        .from("rooms")
        .select("id, host_id, created_at, status, player_count")
        .order("created_at", { ascending: false });
      if (!error && data) setRooms(data as Room[]);
    };
    fetchRooms();
    // 실시간 구독 (insert, update, delete 모두)
    const channel = supabase.channel('rooms-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms' }, fetchRooms)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId]);

  // rooms 목록이 바뀔 때마다 각 방의 players count 가져오기 + players 실시간 구독
  useEffect(() => {
    if (rooms.length === 0) return;
    const fetchAllCounts = async () => {
      const counts: { [roomId: string]: number } = {};
      await Promise.all(
        rooms.map(async (room) => {
          const { count } = await supabase
            .from("players")
            .select("*", { count: "exact", head: true })
            .eq("room_id", room.id);
          counts[room.id] = count ?? 0;
        })
      );
      setPlayerCounts(counts);
    };
    fetchAllCounts();
    // players 테이블 실시간 구독 추가
    const channel = supabase.channel('players-realtime-lobby')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'players' }, fetchAllCounts)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [rooms]);

  // 방 생성
  const handleCreateRoom = async () => {
    if (!userId || !userEmail) return;
    setRoomLoading(true);
    const { data, error } = await supabase
      .from("rooms")
      .insert({ host_id: userId, status: "waiting", player_count: 1 })
      .select();
    if (!error && data && data[0]) {
      // 방장도 플레이어로 자동 등록 (room_id, user_id, user_email 모두 명시)
      await supabase
        .from("players")
        .insert({ room_id: data[0].id, user_id: userId, user_email: userEmail });
      router.push(`/room/${data[0].id}`);
    }
    setRoomLoading(false);
  };

  // 방 입장
  const handleEnterRoom = (roomId: string) => {
    router.push(`/room/${roomId}`);
  };

  // 방 삭제
  const handleDeleteRoom = async (roomId: string) => {
    await supabase.from("rooms").delete().eq("id", roomId);
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  if (loading) return <div>로딩 중...</div>;

  return (
    <div style={{ maxWidth: 400, margin: "40px auto", padding: 24, border: "1px solid #eee", borderRadius: 8 }}>
      <h2>가위바위보 게임 로비</h2>
      <p>안녕하세요, <b>{userEmail}</b> 님!</p>
      <button
        onClick={handleLogout}
        style={{ width: "100%", marginTop: 16, padding: 8, background: "#eee", border: "none", borderRadius: 4, cursor: "pointer" }}
      >
        로그아웃
      </button>
      <hr style={{ margin: "24px 0" }} />
      <button
        onClick={handleCreateRoom}
        disabled={roomLoading}
        style={{ width: "100%", padding: 10, background: "#0070f3", color: "white", border: "none", borderRadius: 4, cursor: "pointer", fontWeight: 600 }}
      >
        {roomLoading ? "방 생성 중..." : "새 게임방 만들기"}
      </button>
      <h3 style={{ marginTop: 32, marginBottom: 12 }}>게임방 목록</h3>
      {rooms.length === 0 ? (
        <div style={{ color: '#888' }}>생성된 게임방이 없습니다.</div>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {rooms.map(room => (
            <li key={room.id} style={{ marginBottom: 12, border: '1px solid #ddd', borderRadius: 6, padding: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>방 ID: {room.id.slice(0, 8)}... | 인원: {playerCounts[room.id] ?? 0} | 상태: {room.status}</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={() => handleEnterRoom(room.id)}
                  style={{ marginLeft: 12, padding: '4px 12px', background: '#eee', border: 'none', borderRadius: 4, cursor: 'pointer' }}
                >
                  입장
                </button>
                {room.host_id === userId && (
                  <button
                    onClick={() => handleDeleteRoom(room.id)}
                    style={{ padding: '4px 12px', background: '#ff4d4f', color: 'white', border: 'none', borderRadius: 4, cursor: 'pointer' }}
                  >
                    삭제
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
