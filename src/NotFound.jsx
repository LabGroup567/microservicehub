import { useNavigate } from 'react-router-dom';

export default function NotFound() {
  const navigate = useNavigate();

  return (
    <div className="pg pg-narrow">
      <div className="empty">
        <h3>Page not found</h3>
        <p>The page you are looking for does not exist or was moved.</p>
        <button className="btn" onClick={() => navigate('/')}>
          Go to home
        </button>
      </div>
    </div>
  );
}
