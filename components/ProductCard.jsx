// components/ProductCard.jsx
'use client';

import { ExternalLink, Tag, Droplets, Star } from 'lucide-react';

export default function ProductCard({ product }) {
  const {
    name, brand, price_usd, skin_type, effects,
    description, product_url, image_url, category,
  } = product;

  return (
    <div className="product-card">
      {image_url && (
        <div className="product-img-wrap">
          <img src={image_url} alt={name} className="product-img" />
        </div>
      )}

      <div className="product-info">
        {brand && <span className="product-brand">{brand}</span>}
        <h4 className="product-name">{name}</h4>

        {category && (
          <div className="product-tag">
            <Tag size={11} />
            {category}
          </div>
        )}

        {effects && effects.length > 0 && (
          <div className="product-effects">
            <Star size={11} />
            {(Array.isArray(effects) ? effects : [effects]).slice(0, 3).join(' · ')}
          </div>
        )}

        {skin_type && skin_type.length > 0 && (
          <div className="product-skin">
            <Droplets size={11} />
            {(Array.isArray(skin_type) ? skin_type : [skin_type]).join(', ')}
          </div>
        )}

        {description && (
          <p className="product-desc">{description.substring(0, 120)}…</p>
        )}

        <div className="product-footer">
          {price_usd && (
            <span className="product-price">${Number(price_usd).toFixed(2)}</span>
          )}
          {product_url && (
            <a
              href={product_url}
              target="_blank"
              rel="noopener noreferrer"
              className="product-btn"
            >
              Xem sản phẩm <ExternalLink size={12} />
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
