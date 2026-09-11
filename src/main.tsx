import { render } from '@builder.io/qwik';
import { Root } from './root';
import './styles/app.css';

const el = document.getElementById('app');
if (!el) throw new Error('缺少 #app 挂载点');
render(el, <Root />);
