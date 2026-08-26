import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { 
  getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { 
  getFirestore, doc, getDoc, setDoc, updateDoc, collection, getDocs, increment 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAmG-m4ztMtLIzISJG6JY7Vs1pt7v1kKaM",
  authDomain: "my-cpa-reward-app.firebaseapp.com",
  projectId: "my-cpa-reward-app",
  storageBucket: "my-cpa-reward-app.firebasestorage.app",
  messagingSenderId: "769066727383",
  appId: "1:769066727383:web:bd52d0668c84019cb4bd92"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

export { 
  signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged,
  doc, getDoc, setDoc, updateDoc, collection, getDocs, increment 
};
