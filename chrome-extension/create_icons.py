from PIL import Image, ImageDraw

def create_icon(size, filename):
    # Create a new image with blue background
    img = Image.new('RGB', (size, size), color='#0052CC')

    # Draw a simple bug emoji or text
    draw = ImageDraw.Draw(img)

    # Add a simple design (white circle)
    margin = size // 4
    draw.ellipse([margin, margin, size-margin, size-margin], fill='white')

    # Save the image
    img.save(filename)
    print(f"Created {filename}")

# Create all three icon sizes
create_icon(16, 'icon16.png')
create_icon(48, 'icon48.png')
create_icon(128, 'icon128.png')

print("All icons created successfully!")
