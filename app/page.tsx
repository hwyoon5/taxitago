'use client';

import { useState, useEffect } from 'react';

export default function Home() {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    async function handleAuthenticate() {
      if (typeof window === 'undefined') return;
      
      const Pi = (window as any).Pi;
      if (!Pi) {
        setError('Pi SDK가 감지되지 않습니다.');
        setLoading(false);
        return;
      }

      try {
        const scopes = ['username', 'payments'];
        function onIncompletePaymentFound(payment: any) {
          console.log('미완료 결제 발견:', payment);
        }

        await Pi.authenticate(scopes, onIncompletePaymentFound);
        const currentUser = await Pi.getUser();
        setUser(currentUser);
      } catch (err: any) {
        setError(err.message || '인증 중 오류가 발생했습니다.');
      } finally {
        setLoading(false);
      }
    }

    handleAuthenticate();
  }, []);

  return (
    <main style={{ padding: '2rem', fontFamily: 'sans-serif', minHeight: '100vh', overflowY: 'auto', WebkitOverflowScrolling: 'touch', paddingBottom: '100px' }}>
      {loading && <p>Authenticating with Pi Network...</p>}
      {error && <p style={{ color: 'red' }}>Error: {error}</p>}
      {user ? (
        <div>
          <p>Welcome, <strong>{user.username}</strong>!</p>
          <p>Successfully authenticated.</p>
          <button
            onClick={() => {
              if (!(window as any).Pi) {
                alert('Pi SDK가 감지되지 않습니다.');
                return;
              }

              try {
               (window as any).Pi.createPayment({
                  amount: 1,
                  memo: "Test Payment for Taxitago",
                  metadata: { paymentType: "test" },
                }, {
                  onReadyForServerApproval: function(paymentId: string) {
                    console.log("Ready for server approval:", paymentId);
                  },
                  onReadyForServerCompletion: function(paymentId: string, txid: string) {
                    console.log("Ready for server completion:", paymentId, txid);
                  },
                  onCancel: function(paymentId: string) {
                    console.log("Payment cancelled:", paymentId);
                  },
                  onError: function(error: any, payment: { paymentId?: string }) {
                    console.error("Payment error:", error, payment);
                  }
                });
              } catch (err: any) {
                alert("결제 요청 중 오류 발생: " + err.message);
              }
            }}
            style={{ padding: '10px 20px', fontSize: '16px', backgroundColor: '#7c3aed', color: '#fff', border: 'none', borderRadius: '5px', cursor: 'pointer' }}
          >
            1 Pi 결제 테스트하기
          </button>
        </div>
      ) : (
        !loading && <p>로그인 정보가 없습니다.</p>
      )}
    </main>
  );
}