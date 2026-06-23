#!/bin/bash
# Post-install script for HandyPOS
# Installs udev rules for thermal printer USB access

set -e

echo "[HandyPOS] Installing udev rules for thermal printer access..."

# Install udev rules
if [ -f "/opt/handy-pos/99-thermal-printers.rules" ]; then
    sudo cp /opt/handy-pos/99-thermal-printers.rules /etc/udev/rules.d/99-thermal-printers.rules
    echo "[HandyPOS] ✓ udev rules installed"
    
    # Reload udev rules
    sudo udevadm control --reload-rules
    sudo udevadm trigger
    echo "[HandyPOS] ✓ udev rules reloaded"
else
    echo "[HandyPOS] ⚠ udev rules file not found at /opt/handy-pos/99-thermal-printers.rules"
fi

# Add current user to lp group for printer access
if ! groups "$USER" | grep -q "\blp\b"; then
    echo "[HandyPOS] Adding user to 'lp' group for printer access..."
    sudo usermod -a -G lp "$USER"
    echo "[HandyPOS] ✓ User added to 'lp' group"
    echo "[HandyPOS] ⚠ Please log out and log back in for group changes to take effect"
else
    echo "[HandyPOS] ✓ User already in 'lp' group"
fi

echo "[HandyPOS] Installation complete!"
