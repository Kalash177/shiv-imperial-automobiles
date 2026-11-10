

import { useEffect, useState } from 'react'

import { supabase } from './supabaseClient'
import './App.css'

const whatsapp = 'https://wa.me/917505884859'

const emptyCar = {
  brand: '',
  model: '',
  variant: '',
  year: '',
  color: '',
  fuel: 'Petrol',
  transmission: 'Manual',
  price: '',
  km: '',
  image: '',
  description: '',
  status: 'Available',
}

function App() {
  const [cars, setCars] = useState([])

 const [isAdmin, setIsAdmin] = useState(false)
const [email, setEmail] = useState('')
const [password, setPassword] = useState('')
  const [showLogin, setShowLogin] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(emptyCar)
  const [selectedImages, setSelectedImages] = useState([])
const [existingImages, setExistingImages] = useState([])
const [imagesToDelete, setImagesToDelete] = useState([])
  const [search, setSearch] = useState('')
  const [selectedCar, setSelectedCar] = useState(null)
const [activeImageIndex, setActiveImageIndex] = useState(0)
  useEffect(() => {
  let mounted = true

  const checkAdmin = async session => {
    if (!session) {
      if (mounted) setIsAdmin(false)
      return
    }

    const { data, error } = await supabase.rpc('is_admin')

    if (mounted) {
      setIsAdmin(!error && data === true)
    }
  }

  supabase.auth.getSession().then(({ data: { session } }) => {
    checkAdmin(session)
  })

  const { data: { subscription } } =
    supabase.auth.onAuthStateChange((_event, session) => {
      setTimeout(() => {
        checkAdmin(session)
      }, 0)
    })

  return () => {
    mounted = false
    subscription.unsubscribe()
  }
}, [])

useEffect(() => {
  const fetchCars = async () => {
    const { data, error } = await supabase
      .from('cars')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Error fetching cars:', error.message)
      return
    }

    setCars(data || [])
  }

  fetchCars()
}, [isAdmin])

 const visibleCars = cars.filter(
  car =>
    (isAdmin || car.status === 'Available') &&
    `${car.brand} ${car.model}`.toLowerCase().includes(search.toLowerCase())
)

  const login = async () => {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  })

  if (error) {
    alert('Login failed: ' + error.message)
    return
  }

  const { data: admin, error: adminError } =
    await supabase.rpc('is_admin')

  if (adminError || !admin) {
    await supabase.auth.signOut()
    alert('You are not authorized as an admin.')
    return
  }

  setIsAdmin(true)
  setShowLogin(false)
  setEmail('')
  setPassword('')
}

  const openAddForm = () => {
  setEditingId(null)
  setForm(emptyCar)
  setSelectedImages([])
  setExistingImages([])
  setImagesToDelete([])
  setShowForm(true)
}

  const openEditForm = car => {
  setEditingId(car.id)
  setForm({ ...emptyCar, ...car })

  setSelectedImages([])
  setExistingImages(
    car.images?.length ? car.images : car.image ? [car.image] : []
  )
  setImagesToDelete([])

  setShowForm(true)
}

  const handleChange = event => {
    const { name, value } = event.target
    setForm(previous => ({ ...previous, [name]: value }))
  }
const handleImageSelect = event => {
  const files = Array.from(event.target.files)

  if (existingImages.length + selectedImages.length + files.length > 5) {
    alert('You can upload a maximum of 5 images per car.')
    event.target.value = ''
    return
  }

  const validFiles = files.filter(file => file.type.startsWith('image/'))

  if (validFiles.length !== files.length) {
    alert('Please select image files only.')
  }

  const newImages = validFiles.map(file => ({
    file,
    preview: URL.createObjectURL(file),
  }))

  setSelectedImages(previous => [...previous, ...newImages])
  event.target.value = ''
}
const saveCar = async event => {
  event.preventDefault()

  if (existingImages.length + selectedImages.length > 5) {
    alert('Maximum 5 images are allowed.')
    return
  }

  if (existingImages.length + selectedImages.length === 0) {
    alert('Please upload at least one car image.')
    return
  }

  const uploadedImages = []
  const uploadedPaths = []

  // Upload new images to Supabase Storage
  for (const item of selectedImages) {
    const safeName = item.file.name.replace(/[^a-zA-Z0-9._-]/g, '-')
    const filePath = `${Date.now()}-${Math.random().toString(36).slice(2)}-${safeName}`

    const { error: uploadError } = await supabase.storage
      .from('car-image')
      .upload(filePath, item.file)

    if (uploadError) {
      if (uploadedPaths.length) {
        await supabase.storage.from('car-image').remove(uploadedPaths)
      }

      alert('Image upload failed: ' + uploadError.message)
      return
    }

    uploadedPaths.push(filePath)

    const { data } = supabase.storage
      .from('car-image')
      .getPublicUrl(filePath)

    uploadedImages.push(data.publicUrl)
  }

  const finalImages = [...existingImages, ...uploadedImages]

  const carData = {
    brand: form.brand.trim(),
    model: form.model.trim(),
    variant: form.variant,
    year: form.year ? Number(form.year) : null,
    color: form.color,
    fuel: form.fuel,
    transmission: form.transmission,
    price: Number(form.price),
    km: Number(form.km) || 0,
    image: finalImages[0],
    images: finalImages,
    description: form.description,
    status: form.status || 'Available',
  }

  let result

  if (editingId) {
    result = await supabase
      .from('cars')
      .update(carData)
      .eq('id', editingId)
      .select()
      .single()
  } else {
    result = await supabase
      .from('cars')
      .insert([carData])
      .select()
      .single()
  }

  if (result.error) {
    if (uploadedPaths.length) {
      await supabase.storage.from('car-image').remove(uploadedPaths)
    }

    alert('Error saving car: ' + result.error.message)
    return
  }

  // Remove old images from Storage if owner deleted them
  const getStoragePath = imageUrl => {
    const marker = '/storage/v1/object/public/car-image/'
    const index = imageUrl.indexOf(marker)

    return index === -1
      ? null
      : decodeURIComponent(imageUrl.slice(index + marker.length))
  }

  const pathsToDelete = imagesToDelete
    .map(getStoragePath)
    .filter(Boolean)

  if (pathsToDelete.length) {
    const { error: deleteError } = await supabase.storage
      .from('car-image')
      .remove(pathsToDelete)

    if (deleteError) {
      alert('Car saved, but some old images could not be deleted.')
    }
  }

  if (editingId) {
    setCars(previous =>
      previous.map(car =>
        car.id === editingId ? result.data : car
      )
    )
  } else {
    setCars(previous => [result.data, ...previous])
  }

  selectedImages.forEach(image => URL.revokeObjectURL(image.preview))

  setShowForm(false)
  setForm(emptyCar)
  setEditingId(null)
  setSelectedImages([])
  setExistingImages([])
  setImagesToDelete([])

  alert('Car saved successfully!')
}

 const markSold = async id => {
  if (window.confirm('Are you sure you want to mark this car as sold?')) {

    const { data, error } = await supabase
      .from('cars')
      .update({ status: 'Sold' })
      .eq('id', id)
      .select()
      .single()

    if (error) {
      alert('Error updating car: ' + error.message)
      return
    }

    setCars(previous =>
      previous.map(car =>
        car.id === id ? data : car
      )
    )

    alert('Car marked as Sold successfully!')
  }
}
const markAvailable = async id => {
  if (window.confirm('Make this car available again?')) {

    const { data, error } = await supabase
      .from('cars')
      .update({ status: 'Available' })
      .eq('id', id)
      .select()
      .single()

    if (error) {
      alert('Error updating car: ' + error.message)
      return
    }

    setCars(previous =>
      previous.map(car =>
        car.id === id ? data : car
      )
    )

    alert('Car is now Available!')
  }
}

  const deleteCar = async id => {
  if (window.confirm('Permanently delete this car?')) {

    const { error } = await supabase
      .from('cars')
      .delete()
      .eq('id', id)

    if (error) {
      alert('Error deleting car: ' + error.message)
      return
    }

    setCars(previous =>
      previous.filter(car => car.id !== id)
    )

    alert('Car deleted successfully!')
  }
}

  const money = price =>
    '₹' + Number(price || 0).toLocaleString('en-IN')

  return (
    <>
      <header className="navbar">
        <a href="#home" className="brand">
          <img src="/shiv-imperial-logo.jpeg" alt="SHIV Imperial Automobiles Logo" />
        </a>

        <nav>
          <a href="#home">Home</a>
          <a href="#inventory">Our Cars</a>
          <a href="#about">About Us</a>
          <a href="#contact">Contact</a>
        </nav>

        {isAdmin ? (
          <button
  className="admin-button"
  onClick={async () => {
    await supabase.auth.signOut()
    setIsAdmin(false)
  }}
>
  Logout
</button>
        ) : (
          <button className="admin-button" onClick={() => setShowLogin(true)}>
            Admin Login
          </button>
        )}
      </header>

      <main>
        <section className="hero" id="home">
          <p className="eyebrow">WELCOME TO SHIV IMPERIAL AUTOMOBILES</p>
          <h1>Drive Your Dreams.<br />Experience Excellence.</h1>
          <p className="hero-description">
            Your journey towards the perfect car starts here.
            Discover a premium automobile buying experience.
          </p>
          <a href="#inventory" className="gold-button">
            Explore Our Collection ↗
          </a>
          <p className="tagline">DRIVE YOUR DREAMS</p>
        </section>

        <section className="inventory section" id="inventory">
          <p className="eyebrow">OUR COLLECTION</p>
          <h2>Available in Stock</h2>

          <input
            className="admin-input search-input"
            placeholder="Search car brand or model..."
            value={search}
            onChange={event => setSearch(event.target.value)}
          />

          {isAdmin && (
            <div className="dashboard">
              <h3>Owner Dashboard</h3>
              <p>
                Total cars: {cars.length} | Available: {cars.filter(c => c.status === 'Available').length} | Sold: {cars.filter(c => c.status === 'Sold').length}
              </p>
              <button className="gold-button" onClick={openAddForm}>
                + Add New Car
              </button>
              <p className="dashboard-note">
              Your inventory is securely synced with the showroom database.
              </p>
            </div>
          )}

          <div className="car-grid">
            {visibleCars.length === 0 ? (
              <div className="empty-stock">
                <h3>Our Collection Is Coming Soon</h3>
                <p>
                  {search
                    ? 'No matching vehicles found.'
                    : 'We are updating our inventory. Contact us for vehicle enquiries.'}
                </p>
              </div>
            ) : (
            visibleCars.map(car => (
                <article className="car-card" key={car.id}>
                 {(car.images?.[0] || car.image) && (
  <img
    className="car-image"
    src={car.images?.[0] || car.image}
    alt={`${car.brand} ${car.model}`}
    onClick={() => {
      setSelectedCar(car)
      setActiveImageIndex(0)
    }}
    style={{ cursor: 'pointer' }}
  />
)}

                  <div className="car-content">
                    <h3>{car.brand} {car.model}</h3>
                    <p>{car.variant}</p>
                    <h3 className="car-price">{money(car.price)}</h3>

                    <p>
                      {car.year} · {car.fuel} · {car.transmission}
                    </p>
                    <p>{car.color} · {Number(car.km || 0).toLocaleString('en-IN')} km</p>
                    <p>{car.description}</p>

                    <a
                      className="gold-button"
                      href={`${whatsapp}?text=${encodeURIComponent(`I am interested in ${car.brand} ${car.model}`)}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Enquire on WhatsApp
                    </a>

                    {isAdmin && (
                      <div className="car-admin-actions">
                        <button onClick={() => openEditForm(car)}>Edit</button>
                        {car.status === 'Available' ? (
  <button onClick={() => markSold(car.id)}>
    Mark Sold
  </button>
) : (
  <button onClick={() => markAvailable(car.id)}>
    Mark Available
  </button>
)}
                        <button onClick={() => deleteCar(car.id)}>Delete</button>
                      </div>
                    )}
                  </div>
                </article>
              ))
            )}
          </div>
        </section>

        <section className="about section" id="about">
          <p className="eyebrow">THE IMPERIAL EXPERIENCE</p>
          <h2>More Than a Car.<br />A Feeling That Stays.</h2>
          <p>
            Welcome to SHIV Imperial Automobiles.
            We believe every great journey begins with the right car.
          </p>
        </section>

        <section className="contact section" id="contact">
          <p className="eyebrow">VISIT OUR SHOWROOM</p>
          <h2>Let's Make Your Dream Drive Real.</h2>
          <p><strong>Owner:</strong> Arpan Bhardwaj</p>
          <p>Near Jiwana Toll Plaza, Delhi–Saharanpur Highway, NH-79B</p>
          <p><strong>Call / WhatsApp: 7505884859</strong></p>
          <a className="gold-button" href={whatsapp} target="_blank" rel="noreferrer">
            Chat With Us on WhatsApp ↗
          </a>
        </section>
      </main>

      <footer>
        <p>© 2026 SHIV IMPERIAL AUTOMOBILES</p>
        <p>DRIVE YOUR DREAMS</p>
        <p>BARAUT, UTTAR PRADESH</p>
      </footer>

      {selectedCar && (
  <div
    className="modal-overlay gallery-overlay"
    onClick={() => setSelectedCar(null)}
  >
    <div
      className="gallery-modal"
      onClick={event => event.stopPropagation()}
    >
      <button
        className="gallery-close"
        onClick={() => setSelectedCar(null)}
      >
        ✕
      </button>

      <h2>
        {selectedCar.brand} {selectedCar.model}
      </h2>

      {(() => {
        const galleryImages =
          selectedCar.images?.length
            ? selectedCar.images
            : selectedCar.image
              ? [selectedCar.image]
              : []

        return (
          <>
            <div className="gallery-main">
              <button
                onClick={() =>
                  setActiveImageIndex(
                    (activeImageIndex - 1 + galleryImages.length) %
                    galleryImages.length
                  )
                }
              >
                ❮
              </button>

              <img
                src={galleryImages[activeImageIndex]}
                alt={`${selectedCar.brand} ${selectedCar.model}`}
              />

              <button
                onClick={() =>
                  setActiveImageIndex(
                    (activeImageIndex + 1) % galleryImages.length
                  )
                }
              >
                ❯
              </button>
            </div>

            <div className="gallery-thumbnails">
              {galleryImages.map((image, index) => (
                <img
                  key={index}
                  src={image}
                  alt={`Car image ${index + 1}`}
                  className={
                    activeImageIndex === index ? 'active-thumbnail' : ''
                  }
                  onClick={() => setActiveImageIndex(index)}
                />
              ))}
            </div>

            <p className="gallery-count">
              Image {activeImageIndex + 1} of {galleryImages.length}
            </p>
          </>
        )
      })()}
    </div>
  </div>
)}

      
{showLogin && (
  <div className="modal-overlay">
    <div className="admin-modal">
      <h2>Owner Login</h2>
      <p>Login with your registered owner account</p>

      {/* Email Input */}
      <input
        type="email"
        className="admin-input"
        placeholder="Enter owner email"
        value={email}
        onChange={event => setEmail(event.target.value)}
        required
      />

      {/* Password Input */}
      <input
        type="password"
        className="admin-input"
        placeholder="Enter password"
        value={password}
        onChange={event => setPassword(event.target.value)}
        required
      />

      <button className="gold-button" onClick={login}>
        Login
      </button>

      <button
        className="cancel-button"
        onClick={() => {
          setShowLogin(false)
          setEmail('')
          setPassword('')
        }}
      >
        Cancel
      </button>
    </div>
  </div>
)}


      {showForm && (
        <div className="modal-overlay">
          <div className="admin-modal car-form-modal">
            <h2>{editingId ? 'Edit Car' : 'Add New Car'}</h2>

            <form onSubmit={saveCar}>
              <label className="form-label">
  Upload Car Images (Maximum 5)

  <input
    className="admin-input"
    type="file"
    accept="image/*"
    multiple
    onChange={handleImageSelect}
  />
</label>
<div className="image-preview-grid">

  {existingImages.map((image, index) => (
    <div className="image-preview-item" key={`existing-${index}`}>
      <img src={image} alt={`Existing Car ${index + 1}`} />

      <button
        type="button"
        onClick={() => {
          setExistingImages(previous =>
            previous.filter((_, i) => i !== index)
          )
          setImagesToDelete(previous => [...previous, image])
        }}
      >
        Remove
      </button>
    </div>
  ))}

  {selectedImages.map((image, index) => (
    <div className="image-preview-item" key={`new-${index}`}>
      <img src={image.preview} alt={`Car Preview ${index + 1}`} />

      <button
        type="button"
        onClick={() => {
          URL.revokeObjectURL(image.preview)
          setSelectedImages(previous =>
            previous.filter((_, i) => i !== index)
          )
        }}
      >
        Remove
      </button>
    </div>
  ))}

</div>
              {[
                ['brand', 'Brand'],
                ['model', 'Model'],
                ['variant', 'Variant'],
                ['year', 'Model Year'],
                ['color', 'Colour'],
                ['price', 'Price in ₹'],
                ['km', 'Kilometres'],
              ].map(([name, label]) => (
                <label className="form-label" key={name}>
                  {label}
                  <input
                    className="admin-input"
                    name={name}
                    type={['year', 'price', 'km'].includes(name) ? 'number' : 'text'}
                    min={['year', 'price', 'km'].includes(name) ? '0' : undefined}
                    value={form[name]}
                    onChange={handleChange}
                    required={['brand', 'model', 'price'].includes(name)}
                  />
                </label>
              ))}

              <label className="form-label">
                Fuel Type
                <select className="admin-input" name="fuel" value={form.fuel} onChange={handleChange}>
                  <option>Petrol</option>
                  <option>Diesel</option>
                  <option>CNG</option>
                  <option>Electric</option>
                  <option>Hybrid</option>
                </select>
              </label>

              <label className="form-label">
                Transmission
                <select className="admin-input" name="transmission" value={form.transmission} onChange={handleChange}>
                  <option>Manual</option>
                  <option>Automatic</option>
                  <option>AMT</option>
                  <option>CVT</option>
                  <option>DCT</option>
                </select>
              </label>

              <label className="form-label">
                Description
                <textarea
                  className="admin-input"
                  name="description"
                  value={form.description}
                  onChange={handleChange}
                />
              </label>

              <button className="gold-button" type="submit">Save Car</button>
              <button className="cancel-button" type="button" onClick={() => setShowForm(false)}>
                Cancel
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  )
}

export default App
