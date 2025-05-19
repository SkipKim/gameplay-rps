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
  game_type?: string;
  board_size?: number;
  current_player_id?: string | null;
}

interface Player {
  id: string;
  user_id: string;
  user_email: string;
  choice: string | null;
  result: string | null;
  restart_ready: boolean | null;
  is_player?: boolean;
}

interface KnightTourState {
  id: string;
  room_id: string;
  board_state: number[][]; // 0: 미방문, 1: 방문
  knight_pos: { x: number; y: number };
  move_history: { x: number; y: number }[];
  turn: number;
  finished: boolean;
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
  const [isPlayer, setIsPlayer] = useState(false);
  const [currentPlayerId, setCurrentPlayerId] = useState<string | null>(null);
  const [knightState, setKnightState] = useState<KnightTourState | null>(null);
  const [knightLoading, setKnightLoading] = useState(false);

  // 방 정보 및 유저 정보 불러오기 (rooms 실시간 구독 포함)
  useEffect(() => {
    const fetchRoom = async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session || !data.session.user) {
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
      if (!error && roomData) {
        setRoom(roomData as Room);
        setCurrentPlayerId(roomData.current_player_id ?? null);
      }
      setLoading(false);
    };
    fetchRoom();
    // rooms 실시간 구독
    const channel = supabase.channel('room-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms', filter: `id=eq.${id}` }, (payload) => {
        if (payload.new) {
          setRoom(payload.new as Room);
          setCurrentPlayerId((payload.new as any).current_player_id ?? null);
        }
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [id, router]);

  // 참가자 목록 fetch 함수 분리 (count 포함)
  const fetchPlayers = async () => {
    if (!room?.id) return;
    const { data, count, error } = await supabase
      .from("players")
      .select("id, user_id, user_email, is_player", { count: "exact" })
      .eq("room_id", room.id);
    if (!error && data) {
      setPlayers(data as Player[]);
      setPlayerCount(count ?? 0);
      // 내 is_player 상태 갱신
      const me = (data as Player[]).find(p => p.user_id === userId);
      setIsPlayer(!!me?.is_player);
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
        setIsPlayer(!!exist.is_player);
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
        setIsPlayer(!!newPlayer.is_player);
        setTimeout(() => { fetchPlayers(); }, 500);
      } else if (error) {
        if (error.message.includes('duplicate key value')) {
          const { data: exist2 } = await supabase
            .from("players")
            .select("*")
            .eq("room_id", room.id)
            .eq("user_id", userId)
            .maybeSingle();
          if (exist2) {
            setMyPlayerId(exist2.id);
            setIsPlayer(!!exist2.is_player);
          }
        }
      }
    };
    joinPlayer();
    return () => { cancelled = true; };
  }, [userId, userEmail, room]);

  // players 실시간 동기화
  useEffect(() => {
    if (!room?.id) return;
    fetchPlayers();
    const channel = supabase.channel('players-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'players', filter: `room_id=eq.${room.id}` }, fetchPlayers)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [room?.id, userId]);

  // knight_tour_states fetch & 실시간 구독
  useEffect(() => {
    if (!room || room.game_type !== 'knight_tour') return;
    const fetchKnightState = async () => {
      const { data, error } = await supabase
        .from("knight_tour_states")
        .select("*")
        .eq("room_id", room.id)
        .single();
      if (!error && data) setKnightState(data as KnightTourState);
      else setKnightState(null);
    };
    fetchKnightState();
    // 실시간 구독
    const channel = supabase.channel('knight-tour-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'knight_tour_states', filter: `room_id=eq.${room.id}` }, (payload) => {
        if (payload.new) setKnightState(payload.new as KnightTourState);
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [room]);

  // 스타트 버튼 클릭 (기사의 여행 전용)
  const handleStart = async () => {
    if (!room || !userId) return;
    // current_player_id가 없을 때만 가능
    if (room.current_player_id) return;
    // rooms에 current_player_id, players에 is_player true로 업데이트
    await supabase.from("rooms").update({ current_player_id: userId, status: "playing" }).eq("id", room.id);
    await supabase.from("players").update({ is_player: true }).eq("room_id", room.id).eq("user_id", userId);
    // knight_tour_states row는 생성하지 않음 (첫 말을 놓을 때 생성)
  };

  // 첫 말을 놓을 때 knight_tour_states row 생성 + insert 후 강제 fetch
  const handleFirstMove = async (x: number, y: number) => {
    if (!room || !isPlayer || knightState) return;
    const size = room.board_size ?? 8;
    const initBoard = Array.from({ length: size }, () => Array(size).fill(0));
    initBoard[y][x] = 1;
    await supabase.from("knight_tour_states").insert({
      room_id: room.id,
      board_state: initBoard,
      knight_pos: { x, y },
      move_history: [{ x, y }],
      turn: 1,
      finished: false,
    });
    console.log(`게임 시작! 기사 시작 위치: (${x}, ${y})`);
  };

  // 기사 이동(플레이어만)
  const handleMove = async (x: number, y: number) => {
    if (!isPlayer) return;
    if (!knightState) {
      // 첫 말을 놓는 경우
      await handleFirstMove(x, y);
      return;
    }
    if (knightState.finished) return;
    const valid = getValidMoves(knightState.knight_pos, knightState.board_state).some(m => m.x === x && m.y === y);
    if (!valid) return;
    const newBoard = knightState.board_state.map(row => [...row]);
    newBoard[y][x] = 1;
    const newHistory = [...knightState.move_history, { x, y }];
    const finished = newHistory.length === (room?.board_size ?? 8) * (room?.board_size ?? 8);
    const { error } = await supabase.from("knight_tour_states").update({
      board_state: newBoard,
      knight_pos: { x, y },
      move_history: newHistory,
      turn: knightState.turn + 1,
      finished,
    }).eq("id", knightState.id);
    if (error) {
      console.log('DB 업데이트 에러', error);
    } else {
      console.log('기사 이동 성공', { x, y });
    }
  };

  // 기사 이동 가능 위치 계산
  const getValidMoves = (pos: { x: number; y: number }, board: number[][]) => {
    if (!pos || !board) return [];
    const size = board.length;
    const moves = [
      [2, 1], [1, 2], [-1, 2], [-2, 1],
      [-2, -1], [-1, -2], [1, -2], [2, -1],
    ];
    return moves
      .map(([dx, dy]) => ({ x: pos.x + dx, y: pos.y + dy }))
      .filter(({ x, y }) => x >= 0 && y >= 0 && x < size && y < size && board[y][x] === 0);
  };

  // 기사 여행 상태 초기화(리셋)
  const handleReset = async () => {
    if (!room) return;
    await supabase.from("knight_tour_states").delete().eq("room_id", room.id);
    setKnightState(null);
    // 플레이어 상태는 그대로 두고, 게임만 리셋
  };

  // 방 나가기(로비로 이동, row 삭제 X)
  const handleLeaveRoom = () => {
    router.push("/");
  };

  // 그만두기(내 row 삭제 + 로비 이동)
  const handleQuit = async () => {
    if (myPlayerId) {
      // 내 row 삭제
      await supabase.from("players").delete().eq("id", myPlayerId);
      // 만약 내가 current_player_id였다면 rooms의 current_player_id, status 초기화
      if (room && room.current_player_id === userId) {
        await supabase.from("rooms").update({ current_player_id: null, status: "waiting" }).eq("id", room.id);
        // 기사 여행 상태도 초기화
        await supabase.from("knight_tour_states").delete().eq("room_id", room.id);
      }
      setTimeout(() => { fetchPlayers(); }, 500);
    }
    // router.push("/"); // 제거!
  };

  if (loading) return <div>로딩 중...</div>;
  if (!room) return <div>방 정보를 불러올 수 없습니다.</div>;

  // 기사 여행이 아닌 방은 안내만 표시
  if (room.game_type !== 'knight_tour') {
    return (
      <div style={{ maxWidth: 400, margin: "40px auto", padding: 24, border: "1px solid #eee", borderRadius: 8 }}>
        <h2>게임방</h2>
        <div style={{ marginBottom: 16 }}>
          <b>방 ID:</b> {room.id.slice(0, 8)}...<br />
          <b>상태:</b> {room.status}<br />
          <b>인원:</b> {playerCount}<br />
          <b>게임:</b> {room.game_type}
        </div>
        <div style={{ color: '#888', marginBottom: 24 }}>이 게임은 아직 준비 중입니다.</div>
        <button onClick={handleLeaveRoom} style={{ marginTop: 32, width: '100%', padding: 8, background: '#eee', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
          로비로 돌아가기
        </button>
      </div>
    );
  }

  // 기사 여행 체스판 UI
  const size = room.board_size ?? 8;
  const board = knightState?.board_state ?? Array.from({ length: size }, () => Array(size).fill(0));
  const knightPos = knightState?.knight_pos ?? null;
  const validMoves = knightPos && board ? getValidMoves(knightPos, board) : [];
  const isMyTurn = isPlayer && !!knightState && !knightState.finished;
  const isFailed = knightState && !knightState.finished && validMoves.length === 0;

  // 플레이어가 아무도 없으면 초기화 버튼 노출
  const hasPlayer = players.some(p => p.is_player);

  return (
    <div style={{ maxWidth: 480, margin: "40px auto", padding: 24, border: "1px solid #eee", borderRadius: 8 }}>
      <h2>기사의 여행 게임방</h2>
      <div style={{ marginBottom: 16 }}>
        <b>방 ID:</b> {room.id.slice(0, 8)}...<br />
        <b>상태:</b> {room.status}<br />
        <b>인원:</b> {playerCount}<br />
        <b>판 크기:</b> {size}x{size}
      </div>
      <h3>참여자 목록</h3>
      <ul style={{ marginBottom: 24 }}>
        {players.map((p) => (
          <li key={p.id} style={{ color: p.user_id === userId ? '#0070f3' : undefined }}>
            {p.user_email} {p.is_player ? '(플레이어)' : '(관전자)'}
          </li>
        ))}
      </ul>
      {/* 스타트 버튼: current_player_id가 없을 때만, 내가 플레이어가 아닐 때만 노출 */}
      {!currentPlayerId && !isPlayer && (
        <>
          <div style={{ color: '#888', marginBottom: 8 }}>기사의 시작 위치를 선택하세요.</div>
          <button
            onClick={handleStart}
            style={{ width: '100%', padding: 10, background: '#0070f3', color: 'white', border: 'none', borderRadius: 4, cursor: 'pointer', fontWeight: 600, marginBottom: 16 }}
          >
            스타트(선착순 1명)
          </button>
        </>
      )}
      {currentPlayerId && !isPlayer && (
        <div style={{ color: '#888', marginBottom: 16 }}>관전 중입니다. (플레이어만 조작 가능)</div>
      )}
      {isPlayer && (
        <div style={{ color: '#0070f3', marginBottom: 16, fontWeight: 600 }}>당신이 플레이어입니다!</div>
      )}
      {/* 체스판 렌더링 */}
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${size}, 32px)`, gap: 2, margin: '24px 0' }}>
        {board.map((row, y) =>
          row.map((cell, x) => {
            const isKnight = knightPos && knightPos.x === x && knightPos.y === y;
            const isVisited = cell === 1;
            // knightState가 없으면(첫 말) 플레이어만 전체 칸 클릭 가능
            // knightState가 있으면 validMoves만 클릭 가능
            const isValid = knightState
              ? isMyTurn && validMoves.some(m => m.x === x && m.y === y)
              : isPlayer && !knightState;
            // 이동 순서 구하기
            let moveOrder = null;
            if (knightState?.move_history) {
              moveOrder = knightState.move_history.findIndex(m => m.x === x && m.y === y);
              if (moveOrder !== -1) moveOrder += 1;
              else moveOrder = null;
            }
            return (
              <div
                key={`${x}-${y}`}
                onClick={() => {
                  if (!knightState && isPlayer) {
                    handleMove(x, y); // 첫 말
                  } else if (isValid) {
                    handleMove(x, y); // 이동
                  }
                }}
                style={{
                  width: 32, height: 32, border: '1px solid #bbb', borderRadius: 4,
                  background: isKnight ? '#0070f3'
                    : isValid ? '#34a853'
                    : isVisited ? '#e0e7ff'
                    : 'white',
                  color: isKnight ? 'white' : '#333',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: isValid ? 'pointer' : 'default', fontWeight: isKnight ? 700 : 400,
                  position: 'relative'
                }}
              >
                {isKnight ? '♞'
                  : moveOrder
                    ? <span style={{ fontSize: 13, color: '#555' }}>{moveOrder}</span>
                    : ''}
              </div>
            );
          })
        )}
      </div>
      {/* 이동 기록 */}
      {knightState && (
        <div style={{ fontSize: 13, color: '#888', marginBottom: 12 }}>
          이동 횟수: {knightState.turn} / {size * size}
        </div>
      )}
      {knightState?.finished && (
        <div style={{ color: '#34a853', fontWeight: 600, marginBottom: 12 }}>모든 칸을 방문했습니다! 🎉</div>
      )}
      {isFailed && (
        <div style={{ color: '#ff4d4f', fontWeight: 600, marginBottom: 12 }}>
          더 이상 이동할 곳이 없습니다. <b>실패!</b>
          <button onClick={handleReset} style={{ marginLeft: 16, padding: '4px 16px', background: '#0070f3', color: 'white', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
            초기화
          </button>
        </div>
      )}
      <button onClick={handleLeaveRoom} style={{ marginTop: 16, width: '100%', padding: 8, background: '#eee', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
        로비로 돌아가기
      </button>
      {isPlayer && (
        <button onClick={handleQuit} style={{ marginTop: 8, width: '100%', padding: 8, background: '#ff4d4f', color: 'white', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
          그만두기
        </button>
      )}
      {!hasPlayer && (
        <button onClick={handleReset} style={{ marginTop: 8, width: '100%', padding: 8, background: '#0070f3', color: 'white', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
          초기화
        </button>
      )}
    </div>
  );
} 