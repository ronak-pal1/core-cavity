import './style.css';
import { Game } from './game/game';

const root = document.querySelector('#app');
if (!(root instanceof HTMLElement)) throw new Error('Missing #app root');
new Game(root);
