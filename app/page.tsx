'use client'

declare global {
  interface Window {
    Pi: any;
  }
}

import { useState, useEffect } from 'react';

export default function Home() {
  const [user, setUser] = useState<any>({ username: "TestUser (Guest)" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    // Pi SDK 초기화 시도 (에러 나더라도 화면이 안 멈추게 처리)
    try {
      if (typeof window !== 'undefined' && (window as any).Pi) {
        (window as any).Pi.init({ version: "2.0", sandbox: true });
      }
    } catch (e) {
      console.log("Pi init skip:", e);
    }
  }, []);

  const handlePayment = () => {
    const Pi = (window as any).Pi;
    if (!Pi) {
      alert('Pi SDK가 감지되지 않았습니다. 파이 브라우저에서 실행 중인지 확인해주세요.');
      return;
    }

    const paymentData = {
      amount: 1,
      memo: "Taxitago 서비스 이용 요금",
      metadata: { service: "taxi" },
    };

    const callbacks = {
      onReadyForServerApproval: async (paymentId: string) => {
        console.log("Ready for server approval:", paymentId);
        try {
          const res = await fetch('/api/payments/approve', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ paymentId }),
          });
          const data = await res.json();
          if (!res.ok) {
            alert('서버 승인 실패: ' + (data.error || JSON.stringify(data)));
          }
        } catch (err: any) {
          alert('서버 통신 에러 (Approve): ' + err.message);
        }
      },
      onReadyForServerCompletion: async (paymentId: string, txid: string) => {
        console.log("Ready for server completion:", txid);
        try {
          const res = await fetch('/api/payments/complete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ paymentId, txid }),
          });
          const data = await res.json();
          if (res.ok) {
            alert('결제가 성공적으로 완료되었습니다!');
          } else {
            alert('서버 완료 처리 실패: ' + (data.error || JSON.stringify(data)));
          }
        } catch (err: any) {
          alert('서버 통신 에러 (Complete): ' + err.message);
        }
      },
      onCancel: (paymentId: string) => {
        alert('결제가 취소되었습니다.');
      },
      onError: (error: any, payment: any) => {
        alert('결제 오류 발생: ' + (error?.message || JSON.stringify(error)));
      }
    };

    try {
      Pi.createPayment(paymentData, callbacks);
    } catch (err: any) {
      alert('결제창 호출 실패: ' + err.message);
    }
  };

  return (
    <main style={{ padding: '20px', fontFamily: 'sans-serif', color: '#fff', backgroundColor: '#000', minHeight: '100vh' }}>
      <h1>Taxitago</h1>
      {loading && <p>로딩 중...</p>}
      {error && <p style={{ color: 'red' }}>{error}</p>}
      {user && (
        <div>
          <p>환영합니다, <strong>{user.username}</strong>님!</p>
          <div style={{ marginTop: '20px' }}>
            <button
              onClick={handlePayment}
              style={{ padding: '10px 20px', backgroundColor: '#f0b90b', color: '#000', border: 'none', borderRadius: '5px', fontWeight: 'bold', cursor: 'pointer' }}
            >
              1 Pi 결제 테스트하기
            </button>
          </div>
        </div>
      )}
    </main>
  );
}