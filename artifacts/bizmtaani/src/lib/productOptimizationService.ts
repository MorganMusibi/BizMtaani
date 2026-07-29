import { 
  collection, 
  query, 
  orderBy, 
  limit, 
  startAfter, 
  getDocs, 
  DocumentData, 
  QueryDocumentSnapshot,
  where
} from "firebase/firestore";
import { db } from "@/lib/firebase";

export interface OptimizedProduct {
  id: string;
  title: string;
  thumbnailUrl: string; // Small, low-res image for feeds/carousels
  price: number;
  category?: string;
  createdAt?: any;
}

// Simple in-memory cache layer to prevent duplicate reads during session
const productCache = new Map<string, { data: any; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes cache expiration

/**
 * Fetch a paginated feed of products using only lightweight thumbnail/price fields
 * to drastically reduce Firestore read document payload size.
 */
export async function fetchOptimizedProductFeed(
  categoryFilter?: string,
  lastVisibleDoc: QueryDocumentSnapshot<DocumentData> | null = null,
  pageSize = 10
) {
  try {
    let q = query(
      collection(db, "products"),
      ...(categoryFilter ? [where("category", "==", categoryFilter)] : []),
      orderBy("createdAt", "desc"),
      limit(pageSize)
    );

    if (lastVisibleDoc) {
      q = query(
        collection(db, "products"),
        ...(categoryFilter ? [where("category", "==", categoryFilter)] : []),
        orderBy("createdAt", "desc"),
        startAfter(lastVisibleDoc),
        limit(pageSize)
      );
    }

    const snapshot = await getDocs(q);
    
    const products: OptimizedProduct[] = snapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        title: data.title || "",
        // Fallback hierarchy: explicit thumbnail -> first image array element -> empty
        thumbnailUrl: data.thumbnailUrl || data.imageUrls?.[0] || "",
        price: data.price || 0,
        category: data.category || "",
        createdAt: data.createdAt || null,
      };
    });

    const lastVisible = snapshot.docs[snapshot.docs.length - 1] || null;

    return {
      products,
      lastVisible,
      hasMore: snapshot.docs.length === pageSize,
    };
  } catch (error) {
    console.error("Error fetching paginated product feed:", error);
    throw error;
  }
}

/**
 * Fetch full details for a single product with local memory caching
 * to avoid repetitive reads if a user navigates back and forth.
 */
export async function fetchCachedProductDetails(productId: string) {
  const cacheKey = `product_${productId}`;
  const cached = productCache.get(cacheKey);

  // Return from memory cache if valid
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  try {
    const docRef = collection(db, "products");
    // If using doc(db, "products", productId):
    const { doc, getDoc } = await import("firebase/firestore");
    const productDoc = await getDoc(doc(db, "products", productId));

    if (!productDoc.exists()) {
      throw new Error("Product not found.");
    }

    const productData = { id: productDoc.id, ...productDoc.data() };

    // Save to cache
    productCache.set(cacheKey, { data: productData, timestamp: Date.now() });

    return productData;
  } catch (error) {
    console.error("Error fetching product details:", error);
    throw error;
  }
}
