import { initializeApp } from "https://www.gstatic.com/firebasejs/9.6.10/firebase-app.js";
import { getFirestore, doc, setDoc, getDoc, onSnapshot, collection, addDoc } from "https://www.gstatic.com/firebasejs/9.6.10/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "",
    authDomain: "",
    projectId: "",
    storageBucket: "",
    messagingSenderId: "",
    appId: ""
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const servers = { iceServers: [{ urls: ['stun:stun.l.google.com:19302'] }] };
let pc = new RTCPeerConnection(servers);
let localStream, remoteStream;

const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const joinBtn = document.getElementById('joinBtn');

async function initMedia() {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
    localVideo.srcObject = localStream;

    remoteStream = new MediaStream();
    pc.ontrack = e => e.streams[0].getTracks().forEach(track => remoteStream.addTrack(track));
    remoteVideo.srcObject = remoteStream;
}

joinBtn.onclick = async () => {
    await initMedia();

    const roomRef = doc(db, "rooms", "main-room"); // фіксована кімната
    const roomSnapshot = await getDoc(roomRef);

    pc.onicecandidate = async e => {
        if (e.candidate) {
            const candidatesCol = collection(roomRef, pc.localDescription ? "callerCandidates" : "calleeCandidates");
            await addDoc(candidatesCol, e.candidate.toJSON());
        }
    };

    if (!roomSnapshot.exists()) {
        // Перший користувач створює offer
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await setDoc(roomRef, { offer: { type: offer.type, sdp: offer.sdp } });

        // Чекаємо на answer
        onSnapshot(roomRef, async snapshot => {
            const data = snapshot.data();
            if (data?.answer && !pc.currentRemoteDescription) {
                await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
            }
        });

        // Чекаємо на ICE від іншого
        onSnapshot(collection(roomRef, "calleeCandidates"), snapshot => {
            snapshot.docChanges().forEach(change => {
                if (change.type === "added") {
                    pc.addIceCandidate(new RTCIceCandidate(change.doc.data()));
                }
            });
        });

    } else {
        // Другий користувач підключається як callee
        const data = roomSnapshot.data();
        const offer = data.offer;
        await pc.setRemoteDescription(new RTCSessionDescription(offer));

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await setDoc(roomRef, { answer: { type: answer.type, sdp: answer.sdp } }, { merge: true });

        // Чекаємо на ICE від першого
        onSnapshot(collection(roomRef, "callerCandidates"), snapshot => {
            snapshot.docChanges().forEach(change => {
                if (change.type === "added") {
                    pc.addIceCandidate(new RTCIceCandidate(change.doc.data()));
                }
            });
        });
    }
};
