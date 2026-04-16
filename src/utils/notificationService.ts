/**
 * Notification Service for Kaleido dApp
 * Handles both browser notifications and sends them to AI Engine notification system
 */

interface NotificationData {
  title: string;
  body: string;
  level: 'info' | 'success' | 'warning' | 'error';
  user_address?: string;
  action_type?: string;
}

// AI Engine API URL from environment
const AI_ENGINE_API_URL = process.env.NEXT_PUBLIC_API_BASE || 'http://127.0.0.1:8000';

/**
 * Send notification to AI Engine notification system
 */
async function sendToAIEngine(notification: NotificationData): Promise<boolean> {
  try {
    // For user-specific notifications, we'll send directly to the notifications endpoint
    // rather than through the chat system which broadcasts to everyone
    const response = await fetch(`${AI_ENGINE_API_URL}/notifications/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title: notification.title,
        body: notification.body,
        level: notification.level,
        timestamp: Date.now(),
        metadata: {
          user_address: notification.user_address,
          action_type: notification.action_type,
          source: 'kaleido_dapp',
          target_user: notification.user_address, // Specify target user
        }
      }),
    });

    if (!response.ok) {
      console.warn('Failed to send notification to AI Engine:', response.status);
      // Fallback: If direct notification endpoint doesn't exist, use chat endpoint
      // but with user-specific context
      return await sendViaChatEndpoint(notification);
    }

    const result = await response.json();
    console.log('User-specific notification sent to AI Engine:', result);
    return true;
  } catch (error) {
    console.error('Error sending notification to AI Engine:', error);
    // Fallback to chat endpoint
    return await sendViaChatEndpoint(notification);
  }
}

/**
 * Fallback method using chat endpoint with user targeting
 */
async function sendViaChatEndpoint(notification: NotificationData): Promise<boolean> {
  try {
    const response = await fetch(`${AI_ENGINE_API_URL}/agent/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages: [{
          role: 'user',
          content: `Send ${notification.level} notification to user ${notification.user_address}: "${notification.title}" - ${notification.body}${notification.action_type ? ` (Action: ${notification.action_type})` : ''} [TARGET_USER_ONLY: ${notification.user_address}]`
        }],
        user_id: notification.user_address || 'kaleido_dapp_user',
        admin_id: '0xb264ae4092999B001C0B88713db0FaD23D1F8804'
      }),
    });

    if (!response.ok) {
      console.warn('Failed to send notification via chat endpoint:', response.status);
      return false;
    }

    const result = await response.json();
    console.log('Notification sent via chat endpoint:', result);
    return true;
  } catch (error) {
    console.error('Error sending notification via chat endpoint:', error);
    return false;
  }
}

/**
 * Send browser notification
 */
function sendBrowserNotification(title: string, body: string): void {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  
  if (Notification.permission === 'granted') {
    new Notification(title, { body });
  } else if (Notification.permission !== 'denied') {
    Notification.requestPermission().then(permission => {
      if (permission === 'granted') {
        new Notification(title, { body });
      }
    });
  }
}

/**
 * Play notification sound
 */
function playNotificationSound(): void {
  try {
    // Create a notification sound using Web Audio API
    if (typeof window !== 'undefined' && 'AudioContext' in window) {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      
      // Create a pleasant notification sound (two-tone chime)
      const playTone = (frequency: number, duration: number, delay: number = 0) => {
        setTimeout(() => {
          const oscillator = audioContext.createOscillator();
          const gainNode = audioContext.createGain();
          
          oscillator.connect(gainNode);
          gainNode.connect(audioContext.destination);
          
          oscillator.frequency.setValueAtTime(frequency, audioContext.currentTime);
          oscillator.type = 'sine';
          
          // Smooth fade in and out to avoid clicking sounds
          gainNode.gain.setValueAtTime(0, audioContext.currentTime);
          gainNode.gain.linearRampToValueAtTime(0.1, audioContext.currentTime + 0.01);
          gainNode.gain.linearRampToValueAtTime(0.1, audioContext.currentTime + duration - 0.01);
          gainNode.gain.linearRampToValueAtTime(0, audioContext.currentTime + duration);
          
          oscillator.start(audioContext.currentTime);
          oscillator.stop(audioContext.currentTime + duration);
        }, delay);
      };
      
      // Play a pleasant two-tone notification sound
      playTone(800, 0.15, 0);    // First tone (higher)
      playTone(600, 0.2, 100);   // Second tone (lower) with slight delay
      
      console.log('🔊 Notification sound played');
    }
  } catch (error) {
    console.warn('Could not play notification sound:', error);
    
    // Fallback: try to play a simple beep using an audio element
    try {
      const audio = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBji2yNPQ') || '';
    } catch (fallbackError) {
      console.warn('Fallback notification sound also failed:', fallbackError);
    }
  }
}

/**
 * Unified notification function that sends both browser and AI Engine notifications
 */
export async function sendNotification(
  title: string,
  body: string,
  level: 'info' | 'success' | 'warning' | 'error' = 'info',
  options: {
    user_address?: string;
    action_type?: string;
    browserNotification?: boolean;
    addToLocalContext?: boolean;
    playSound?: boolean;
  } = {}
): Promise<void> {
  // Play notification sound if requested (default true)
  if (options.playSound !== false) {
    playNotificationSound();
  }

  // Send browser notification if requested (default true)
  if (options.browserNotification !== false) {
    sendBrowserNotification(title, body);
  }

  // Add to local storage for immediate UI update
  if (options.addToLocalContext !== false) {
    try {
      const existingNotifications = JSON.parse(localStorage.getItem('kaleido_notifications') || '[]');
      const newNotification = {
        id: crypto.randomUUID(),
        title,
        body,
        level,
        timestamp: Date.now(),
        read: false
      };
      existingNotifications.unshift(newNotification);
      localStorage.setItem('kaleido_notifications', JSON.stringify(existingNotifications.slice(0, 100)));
      
      // Trigger a storage event to update the UI
      window.dispatchEvent(new StorageEvent('storage', {
        key: 'kaleido_notifications',
        newValue: JSON.stringify(existingNotifications.slice(0, 100))
      }));
    } catch (error) {
      console.warn('Failed to add notification to local context:', error);
    }
  }

  // Send to AI Engine notification system
  const notificationData: NotificationData = {
    title,
    body,
    level,
    user_address: options.user_address,
    action_type: options.action_type,
  };

  await sendToAIEngine(notificationData);
}

/**
 * Health factor specific notification
 */
export async function sendHealthFactorWarning(
  healthFactor: number,
  userAddress: string
): Promise<void> {
  const title = "🚨 Health Factor Warning";
  const body = `Your health factor is ${healthFactor.toFixed(3)}. Risk of liquidation! Add more collateral or repay loans immediately.`;
  
  await sendNotification(title, body, 'warning', {
    user_address: userAddress,
    action_type: 'health_factor_warning',
  });
}

/**
 * Loan creation notification
 */
export async function sendLoanCreatedNotification(
  userAddress: string,
  loanType: 'borrow' | 'lending'
): Promise<void> {
  const title = "Order Created";
  const body = `Your ${loanType} order was successfully created.`;
  
  await sendNotification(title, body, 'success', {
    user_address: userAddress,
    action_type: 'loan_created',
  });
}

/**
 * Loan filled notification
 */
export async function sendLoanFilledNotification(
  userAddress: string
): Promise<void> {
  const title = "Order Filled";
  const body = "You have successfully filled or serviced an order.";
  
  await sendNotification(title, body, 'success', {
    user_address: userAddress,
    action_type: 'loan_filled',
  });
}

/**
 * New borrow request notification
 */
export async function sendNewBorrowRequestNotification(
  userAddress: string
): Promise<void> {
  const title = "New Borrow Request";
  const body = "A new borrow request was created that may be relevant to you.";
  
  await sendNotification(title, body, 'info', {
    user_address: userAddress,
    action_type: 'new_borrow_request',
  });
}

/**
 * Loan repaid notification
 */
export async function sendLoanRepaidNotification(
  userAddress: string
): Promise<void> {
  const title = "Loan Repaid";
  const body = "A loan you are involved with was repaid.";
  
  await sendNotification(title, body, 'success', {
    user_address: userAddress,
    action_type: 'loan_repaid',
  });
}

/**
 * Liquidation notification
 */
export async function sendLiquidationNotification(
  userAddress: string
): Promise<void> {
  const title = "Order Liquidated";
  const body = "A request you are involved with was liquidated.";
  
  await sendNotification(title, body, 'error', {
    user_address: userAddress,
    action_type: 'liquidation',
  });
}

