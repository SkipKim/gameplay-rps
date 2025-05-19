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
  game_type: string;
  board_size: number;
}

export default function MainPage() {
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [roomLoading, setRoomLoading] = useState(false);
  const [playerCounts, setPlayerCounts] = useState<{ [roomId: string]: number }>({});
  const [gameType, setGameType] = useState<'knight_tour' | 'rps'>("knight_tour");
  const [boardSize, setBoardSize] = useState<5 | 6 | 8>(8);
  const [myPlayingRooms, setMyPlayingRooms] = useState<{ [roomId: string]: boolean }>({});
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
        .select("id, host_id, created_at, status, player_count, game_type, board_size")
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
    if (rooms.length === 0 || !userId) return;
    const fetchAllCountsAndMyPlaying = async () => {
      const counts: { [roomId: string]: number } = {};
      const playing: { [roomId: string]: boolean } = {};
      await Promise.all(
        rooms.map(async (room) => {
          const { data, count } = await supabase
            .from("players")
            .select("user_id, is_player", { count: "exact" })
            .eq("room_id", room.id);
          counts[room.id] = count ?? 0;
          if (data && Array.isArray(data)) {
            playing[room.id] = data.some(p => p.user_id === userId && p.is_player);
          } else {
            playing[room.id] = false;
          }
        })
      );
      setPlayerCounts(counts);
      setMyPlayingRooms(playing);
    };
    fetchAllCountsAndMyPlaying();
    // players 테이블 실시간 구독 추가
    const channel = supabase.channel('players-realtime-lobby')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'players' }, fetchAllCountsAndMyPlaying)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [rooms, userId]);

  // 방 생성
  const handleCreateRoom = async () => {
    if (!userId || !userEmail) return;
    setRoomLoading(true);
    const insertRoom: any = {
      host_id: userId,
      status: "waiting",
      game_type: gameType,
    };
    if (gameType === "knight_tour") {
      insertRoom.board_size = boardSize;
    }
    const { data, error } = await supabase
      .from("rooms")
      .insert(insertRoom)
      .select();
    if (!error && data && data[0]) {
      // 방장도 플레이어로 자동 등록 (is_player: true)
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
      <h2>게임 로비</h2>
      <p>안녕하세요, <b>{userEmail}</b> 님!</p>
      <button
        onClick={handleLogout}
        style={{ width: "100%", marginTop: 16, padding: 8, background: "#eee", border: "none", borderRadius: 4, cursor: "pointer" }}
      >
        로그아웃
      </button>
      <hr style={{ margin: "24px 0" }} />
      {/* 게임 종류/판 크기 선택 폼 */}
      <div style={{ marginBottom: 16 }}>
        <label style={{ fontWeight: 600 }}>게임 종류: </label>
        <select
          value={gameType}
          onChange={e => setGameType(e.target.value as 'knight_tour' | 'rps')}
          style={{ marginLeft: 8, padding: 4 }}
        >
          <option value="knight_tour">기사의 여행</option>
          <option value="rps">가위바위보</option>
        </select>
        {gameType === "knight_tour" && (
          <>
            <label style={{ marginLeft: 16, fontWeight: 600 }}>판 크기: </label>
            <select
              value={boardSize}
              onChange={e => setBoardSize(Number(e.target.value) as 5 | 6 | 8)}
              style={{ marginLeft: 8, padding: 4 }}
            >
              <option value={5}>5x5</option>
              <option value={6}>6x6</option>
              <option value={8}>8x8</option>
            </select>
          </>
        )}
      </div>
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
              <span>
                방 ID: {room.id.slice(0, 8)}... |
                인원: {playerCounts[room.id] ?? 0} |
                게임: {room.game_type === 'knight_tour' ? `기사의 여행(${room.board_size}x${room.board_size})` : '가위바위보'} |
                상태: {room.status}
                {myPlayingRooms[room.id] && (
                  <span style={{ marginLeft: 8, background: '#0070f3', color: 'white', borderRadius: 4, padding: '2px 8px', fontSize: 12, fontWeight: 600 }}>
                    플레이중
                  </span>
                )}
              </span>
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
